import { describe, it, expect, beforeEach, mock } from "bun:test";

// Retention pass over activity_logs. The row count is unbounded without it, and
// the only thing that keeps the table small is the createdAt cutoff — so that
// cutoff (30 days) and the fact that a delete actually runs are what matter.

const state: {
  deleteArgs: Array<{ where: { createdAt: { lt: unknown } } }>;
  deletedCount: number;
} = {
  deleteArgs: [],
  deletedCount: 0,
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    activityLog: {
      deleteMany: (args: { where: { createdAt: { lt: unknown } } }) => {
        state.deleteArgs.push(args);
        return Promise.resolve({ count: state.deletedCount });
      },
    },
  },
}));

const { cleanupOldActivityLogs } = await import(
  "@rawkoon/api/workers/cleanupNotifications"
);

describe("cleanupOldActivityLogs", () => {
  beforeEach(() => {
    state.deleteArgs = [];
    state.deletedCount = 0;
  });

  it("deletes rows older than 30 days and returns the count", async () => {
    state.deletedCount = 58_000;
    const before = Date.now();
    const count = await cleanupOldActivityLogs();
    const after = Date.now();

    expect(count).toBe(58_000);
    expect(state.deleteArgs).toHaveLength(1);

    const cutoff = state.deleteArgs[0].where.createdAt.lt as Date;
    const cutoffMs = new Date(cutoff).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    // Cutoff is ~30 days before now (allow the test's own execution window).
    expect(cutoffMs).toBeGreaterThanOrEqual(before - thirtyDaysMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - thirtyDaysMs + 1000);
  });

  it("returns 0 and does not throw when the delete fails", async () => {
    state.deleteArgs = [];
    // Force the mock to reject for this one call.
    const realDb = await import("@rawkoon/api/db");
    const original = realDb.prisma.activityLog.deleteMany;
    realDb.prisma.activityLog.deleteMany = () =>
      Promise.reject(new Error("db down"));

    const count = await cleanupOldActivityLogs();
    expect(count).toBe(0);

    realDb.prisma.activityLog.deleteMany = original;
  });
});
