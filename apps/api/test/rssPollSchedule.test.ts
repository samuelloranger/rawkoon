import { describe, expect, it, spyOn } from "bun:test";
import { mapSettings } from "@rawkoon/api/routes/library/libraryMediaAdmin";
import {
  applyRssPollSchedule,
  loadRssPollInterval,
  rescheduleRssPollThenPersist,
} from "@rawkoon/api/services/rss/rssPollSchedule";

function fakeQueue(failOn?: (pattern: string) => boolean) {
  const calls: string[] = [];
  return {
    calls,
    queue: {
      upsertJobScheduler: async (
        id: string,
        repeat: { pattern?: string },
        template?: { name?: string },
      ) => {
        const pattern = repeat.pattern ?? "";
        if (failOn?.(pattern)) throw new Error("bad pattern");
        calls.push(`upsert ${id} ${pattern} ${template?.name}`);
        return undefined as never;
      },
    },
  };
}

describe("applyRssPollSchedule", () => {
  it("upserts the RSS poll scheduler in place", async () => {
    const { calls, queue } = fakeQueue();
    await applyRssPollSchedule(5, queue);
    expect(calls).toEqual([
      "upsert poll-indexer-rss 2-59/5 * * * * poll-indexer-rss",
    ]);
  });
});

describe("loadRssPollInterval", () => {
  it("falls back to 15 minutes when no settings row can be read", async () => {
    expect(await loadRssPollInterval(async () => undefined)).toBe(15);
  });

  it("returns a stored offered interval", async () => {
    expect(await loadRssPollInterval(async () => 5)).toBe(5);
  });

  it("falls back with a warning when the stored interval is not offered", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await loadRssPollInterval(async () => 7)).toBe(15);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("falls back when reading throws", async () => {
    expect(
      await loadRssPollInterval(async () => {
        throw new Error("db down");
      }),
    ).toBe(15);
  });
});

describe("rescheduleRssPollThenPersist", () => {
  it("schedules before it persists", async () => {
    const { calls, queue } = fakeQueue();
    const order: string[] = [];
    await rescheduleRssPollThenPersist(
      5,
      15,
      async () => {
        order.push(`persist after ${calls.length} upserts`);
      },
      queue,
    );
    expect(order).toEqual(["persist after 1 upserts"]);
  });

  it("leaves the stored value unchanged and restores the old schedule when scheduling fails", async () => {
    let persisted = false;
    const { calls, queue } = fakeQueue((pattern) =>
      pattern.endsWith("/5 * * * *"),
    );
    await expect(
      rescheduleRssPollThenPersist(
        5,
        15,
        async () => {
          persisted = true;
        },
        queue,
      ),
    ).rejects.toThrow("bad pattern");
    expect(persisted).toBe(false);
    expect(calls).toEqual([
      "upsert poll-indexer-rss 7-59/15 * * * * poll-indexer-rss",
    ]);
  });

  it("restores the old schedule when persisting fails", async () => {
    const { calls, queue } = fakeQueue();
    await expect(
      rescheduleRssPollThenPersist(
        5,
        15,
        async () => {
          throw new Error("db down");
        },
        queue,
      ),
    ).rejects.toThrow("db down");
    expect(calls.at(-1)).toBe(
      "upsert poll-indexer-rss 7-59/15 * * * * poll-indexer-rss",
    );
  });
});

describe("mapSettings rss_poll_interval_minutes", () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({
      fileOperation: "hardlink",
      movieTemplate: "",
      episodeTemplate: "",
      minSeedRatio: 0,
      postProcessingEnabled: false,
      updatedAt: new Date("2026-08-24T00:00:00Z"),
      ...over,
    }) as never;

  it("defaults to 15 minutes", () => {
    expect(mapSettings(row()).rss_poll_interval_minutes).toBe(15);
  });

  it("maps the stored interval", () => {
    expect(
      mapSettings(row({ rssPollIntervalMinutes: 30 }))
        .rss_poll_interval_minutes,
    ).toBe(30);
  });
});
