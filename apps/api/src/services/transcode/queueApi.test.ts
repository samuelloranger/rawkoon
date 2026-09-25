import { describe, expect, it, mock } from "bun:test";

let status = "queued";
const cancelled: number[] = [];
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
  },
}));
mock.module("@rawkoon/api/services/transcode/index", () => ({
  transcodeDispatcher: {
    cancel: (id: number) => {
      cancelled.push(id);
      return true;
    },
    live: () => null,
  },
}));

const { cancelOrRemove } = await import(
  "@rawkoon/api/services/transcode/queueApi"
);

describe("cancelOrRemove", () => {
  it("cancels the running job when the dispatcher claimed it mid-request", async () => {
    expect(await cancelOrRemove(5)).toBe("cancelled");
    expect(cancelled).toEqual([5]);
  });
});
