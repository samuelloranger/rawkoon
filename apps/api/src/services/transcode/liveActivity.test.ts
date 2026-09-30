import { describe, expect, it, mock } from "bun:test";

let claimedJob: number | null = null;
const sent: string[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    liveActivityDevice: {
      findUnique: async () => ({ id: 1, startToken: "a".repeat(64) }),
      // Mirrors the SQL claim: only a device not already on this job is updated.
      updateMany: async ({
        where,
        data,
      }: {
        where: { currentJobId?: number };
        data: { currentJobId: number | null };
      }) => {
        if (where.currentJobId !== undefined) {
          if (claimedJob !== where.currentJobId) return { count: 0 };
        } else if (claimedJob === data.currentJobId) return { count: 0 };
        claimedJob = data.currentJobId;
        return { count: 1 };
      },
      delete: async () => ({}),
    },
  },
}));

mock.module("@rawkoon/api/utils/apns", () => ({
  sendLiveActivityViaRelay: async (push: { event: string }) => {
    sent.push(push.event);
    await new Promise((r) => setTimeout(r, 1));
    return { success: true };
  },
}));

const { shouldSendUpdate, transcodeLiveActivity } = await import(
  "@rawkoon/api/services/transcode/liveActivity"
);

const job = {
  id: 9,
  title: "T",
  settings: { codec: "hevc" },
} as never;

describe("transcodeLiveActivity.startForInstallation", () => {
  it("starts one activity when two registrations race for the same job", async () => {
    await Promise.all([
      transcodeLiveActivity.startForInstallation("i", job),
      transcodeLiveActivity.startForInstallation("i", job),
    ]);
    expect(sent).toEqual(["start"]);
    expect(claimedJob).toBe(9);
  });
});

describe("shouldSendUpdate", () => {
  const t0 = Date.parse("2026-09-30T12:00:00Z");
  const last = (
    over: Partial<Parameters<typeof shouldSendUpdate>[0]> = {},
  ) => ({
    lastStep: "encode",
    lastProgress: 0.1,
    lastSentAt: new Date(t0),
    ...over,
  });
  it("sends the first update and every step change", () => {
    expect(
      shouldSendUpdate(last({ lastSentAt: null }), "encode", 0.1, t0),
    ).toBe(true);
    expect(shouldSendUpdate(last(), "validate", 0.1, t0 + 1000)).toBe(true);
  });
  it("sends a 1% move once 30 seconds have passed, not before", () => {
    expect(shouldSendUpdate(last(), "encode", 0.115, t0 + 20_000)).toBe(false);
    expect(shouldSendUpdate(last(), "encode", 0.115, t0 + 31_000)).toBe(true);
  });
  it("stays quiet for a sub-percent move until the heartbeat", () => {
    expect(shouldSendUpdate(last(), "encode", 0.103, t0 + 120_000)).toBe(false);
    expect(shouldSendUpdate(last(), "encode", 0.103, t0 + 301_000)).toBe(true);
  });
  it("no longer waits for a 5% move (the lock screen stuck near 0%)", () => {
    expect(
      shouldSendUpdate(
        last({ lastProgress: 0.003 }),
        "encode",
        0.028,
        t0 + 60_000,
      ),
    ).toBe(true);
  });
});
