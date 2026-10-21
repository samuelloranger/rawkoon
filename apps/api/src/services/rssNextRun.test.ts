import { afterEach, describe, expect, it, mock, setSystemTime } from "bun:test";

let next: number | undefined;
mock.module("@rawkoon/api/services/queueService", () => ({
  SCHEDULED_JOB_NAMES: { POLL_INDEXER_RSS: "poll-rss" },
  scheduledTasksQueue: {
    getJobSchedulers: async () => [{ name: "poll-rss", next }],
  },
}));

const { getNextRssRunAt } = await import("./rssNextRun");

afterEach(() => setSystemTime());

describe("getNextRssRunAt", () => {
  it("returns the scheduler's next run when it is in the future", async () => {
    setSystemTime(new Date("2026-01-01T10:07:00Z"));
    next = new Date("2026-01-01T10:12:00Z").getTime();
    expect(await getNextRssRunAt()).toBe("2026-01-01T10:12:00.000Z");
  });

  it("falls back to the next tick of the default interval when the scheduler has none", async () => {
    setSystemTime(new Date("2026-01-01T10:07:00Z"));
    next = undefined;
    expect(await getNextRssRunAt(async () => 15)).toBe(
      "2026-01-01T10:22:00.000Z",
    );
  });

  it("follows the stored interval in the fallback", async () => {
    setSystemTime(new Date("2026-01-01T10:07:00Z"));
    next = undefined;
    expect(await getNextRssRunAt(async () => 5)).toBe(
      "2026-01-01T10:12:00.000Z",
    );
  });

  it("rolls over the hour in the fallback", async () => {
    setSystemTime(new Date("2026-01-01T10:53:00Z"));
    next = new Date("2026-01-01T10:00:00Z").getTime();
    expect(await getNextRssRunAt(async () => 15)).toBe(
      "2026-01-01T11:07:00.000Z",
    );
  });
});
