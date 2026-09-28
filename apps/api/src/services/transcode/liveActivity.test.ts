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

const { transcodeLiveActivity } = await import(
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
