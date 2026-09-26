import { describe, expect, it, mock } from "bun:test";

let status = "queued";
const cancelled: number[] = [];
let ticks = 0;
const settingsRow = {
  paused: false,
  windowEnabled: true,
  windowStart: "01:00",
  windowEnd: "08:00",
  ssimThreshold: 0.97,
  ssimClipMin: 0.95,
  cpuThreads: null,
};
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    transcodeJob: {
      findUnique: async () => ({ status }),
      // The dispatcher claims the row between our read and our write.
      updateMany: async ({ where }: { where: { status: string } }) => {
        status = "running";
        return { count: where.status === status ? 1 : 0 };
      },
      update: async () => {
        throw new Error("unconditional update must not be used");
      },
    },
    transcodeSettings: {
      upsert: async () => settingsRow,
      update: async ({ data }: { data: Partial<typeof settingsRow> }) => {
        for (const [k, v] of Object.entries(data))
          if (v !== undefined) Object.assign(settingsRow, { [k]: v });
        return settingsRow;
      },
    },
  },
}));
mock.module("@rawkoon/api/services/transcode/index", () => ({
  transcodeDispatcher: {
    cancel: (id: number) => {
      cancelled.push(id);
      return true;
    },
    live: () => null,
    tick: async () => {
      ticks++;
    },
  },
}));

const { cancelOrRemove, updateQueueSettings } = await import(
  "@rawkoon/api/services/transcode/queueApi"
);

describe("cancelOrRemove", () => {
  it("cancels the running job when the dispatcher claimed it mid-request", async () => {
    expect(await cancelOrRemove(5)).toBe("cancelled");
    expect(cancelled).toEqual([5]);
  });
});

describe("updateQueueSettings", () => {
  it("kicks the dispatcher when the run window is turned off", async () => {
    ticks = 0;
    await updateQueueSettings({ window_enabled: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(ticks).toBe(1);
  });

  it("kicks the dispatcher when the queue is resumed", async () => {
    ticks = 0;
    await updateQueueSettings({ paused: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(ticks).toBe(1);
  });

  it("leaves the dispatcher alone for threshold changes", async () => {
    ticks = 0;
    await updateQueueSettings({ ssim_threshold: 0.98 });
    await new Promise((r) => setTimeout(r, 0));
    expect(ticks).toBe(0);
  });
});
