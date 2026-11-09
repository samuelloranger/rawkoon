import { describe, expect, it } from "bun:test";

import { enqueueFresh } from "@rawkoon/api/routes/library/libraryJobWorkerRoutes";

function fakeQueue(state: string | null) {
  const calls: string[] = [];
  const queue = {
    getJob: async () =>
      state
        ? {
            getState: async () => state,
            remove: async () => {
              calls.push("remove");
            },
          }
        : undefined,
    add: async (_n: string, _d: object, o: { jobId: string }) => {
      calls.push("add");
      return { id: o.jobId };
    },
  };
  return { queue: queue as never, calls };
}

describe("enqueueFresh", () => {
  it("removes a finished job before re-adding so the rerun is not ignored", async () => {
    for (const state of ["completed", "failed"]) {
      const { queue, calls } = fakeQueue(state);
      const r = await enqueueFresh(queue, "n", {}, "id");
      expect(r).toEqual({ running: false, jobId: "id" });
      expect(calls).toEqual(["remove", "add"]);
    }
  });

  it("reports a queued or active job as running without adding", async () => {
    for (const state of ["active", "waiting", "delayed"]) {
      const { queue, calls } = fakeQueue(state);
      expect(await enqueueFresh(queue, "n", {}, "id")).toEqual({
        running: true,
      });
      expect(calls).toEqual([]);
    }
  });

  it("adds when no job exists", async () => {
    const { queue, calls } = fakeQueue(null);
    expect(await enqueueFresh(queue, "n", {}, "id")).toEqual({
      running: false,
      jobId: "id",
    });
    expect(calls).toEqual(["add"]);
  });
});
