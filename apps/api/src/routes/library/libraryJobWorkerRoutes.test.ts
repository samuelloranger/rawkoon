import { describe, expect, it } from "bun:test";

import { enqueueFresh } from "@rawkoon/api/routes/library/libraryJobWorkerRoutes";

function fakeQueue(state: string | null, removeThrows = false) {
  let gone = false;
  const calls: string[] = [];
  const queue = {
    getJob: async () =>
      state && !gone
        ? {
            getState: async () => state,
            remove: async () => {
              calls.push("remove");
              if (removeThrows) throw new Error("locked");
              gone = true;
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

  it("treats a job that cannot be removed as running, not a 500", async () => {
    const { queue, calls } = fakeQueue("completed", true);
    expect(await enqueueFresh(queue, "n", {}, "id")).toEqual({ running: true });
    expect(calls).toEqual(["remove"]);
  });

  it("adds when a failed remove lost a race with another remover", async () => {
    const { queue, calls } = fakeQueue("completed", true);
    const q = queue as unknown as { getJob: () => Promise<unknown> };
    const orig = q.getJob;
    let n = 0;
    q.getJob = async () => (n++ === 0 ? orig() : undefined);
    expect(await enqueueFresh(queue, "n", {}, "id")).toEqual({
      running: false,
      jobId: "id",
    });
    expect(calls).toEqual(["remove", "add"]);
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
