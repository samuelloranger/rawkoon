import { describe, expect, it } from "bun:test";
import {
  type DiscardDeps,
  discardFailedJob,
  type FreeSourceDeps,
  freeSeededSource,
  previewFreeSource,
} from "@rawkoon/api/services/transcode/jobCleanup";

function freeDeps(over: Partial<FreeSourceDeps> = {}) {
  const released: string[] = [];
  const marked: number[] = [];
  const deps: FreeSourceDeps = {
    loadJob: async () => ({ status: "done", mediaId: 5, episodeId: null }),
    heldHashes: async () => ["aa", "bb"],
    inspect: async () => [
      { hash: "aa", isPrivate: true, targetMet: false },
      { hash: "bb", isPrivate: false, targetMet: false },
    ],
    markFreed: async (id) => {
      marked.push(id);
    },
    release: async (hash) => {
      released.push(hash);
      return { status: "released", freedBytes: 100 };
    },
    ...over,
  };
  return { deps, released, marked };
}

describe("freeSeededSource", () => {
  it("releases every torrent still holding the old file and sums the space", async () => {
    const { deps, released } = freeDeps();
    expect(await freeSeededSource(1, deps)).toEqual({
      status: "ok",
      torrents: 2,
      freedBytes: 200,
      skipped: 0,
    });
    expect(released).toEqual(["aa", "bb"]);
  });
  it("counts torrents it could not release as skipped", async () => {
    const { deps } = freeDeps({
      release: async (hash) =>
        hash === "aa"
          ? { status: "adopted" }
          : { status: "released", freedBytes: null },
    });
    expect(await freeSeededSource(1, deps)).toEqual({
      status: "ok",
      torrents: 1,
      freedBytes: 0,
      skipped: 1,
    });
  });
  it("marks the history row as no longer sharing once everything is released", async () => {
    const { deps, marked } = freeDeps();
    await freeSeededSource(4, deps);
    expect(marked).toEqual([4]);
  });
  it("marks a row whose torrents are already gone", async () => {
    const { deps, marked } = freeDeps({
      release: async () => ({ status: "not_found" }),
    });
    expect(await freeSeededSource(4, deps)).toMatchObject({
      status: "ok",
      torrents: 0,
      skipped: 0,
    });
    expect(marked).toEqual([4]);
  });
  it("keeps the row as sharing while a torrent is left in place", async () => {
    const { deps, marked } = freeDeps({
      release: async () => ({ status: "adopted" }),
    });
    await freeSeededSource(4, deps);
    expect(marked).toEqual([]);
  });
  it("reports an unreachable download client instead of nothing to free", async () => {
    const { deps, marked } = freeDeps({
      release: async () => ({ status: "unavailable" }),
    });
    expect(await freeSeededSource(4, deps)).toEqual({ status: "unavailable" });
    expect(marked).toEqual([]);
  });
  it("only applies to a finished re-encode", async () => {
    const { deps, released } = freeDeps({
      loadJob: async () => ({ status: "failed", mediaId: 5, episodeId: null }),
    });
    expect(await freeSeededSource(1, deps)).toEqual({ status: "not_done" });
    expect(released).toEqual([]);
  });
  it("answers not_found for an unknown job", async () => {
    const { deps } = freeDeps({ loadJob: async () => null });
    expect(await freeSeededSource(1, deps)).toEqual({ status: "not_found" });
  });
});

describe("previewFreeSource", () => {
  it("counts the private torrents that have not reached their target", async () => {
    const { deps } = freeDeps();
    expect(await previewFreeSource(1, deps)).toEqual({
      status: "ok",
      torrents: 2,
      privateUnmet: 1,
    });
  });
  it("does not warn once the private target is met or the tracker is public", async () => {
    const { deps } = freeDeps({
      inspect: async () => [
        { hash: "aa", isPrivate: true, targetMet: true },
        { hash: "bb", isPrivate: false, targetMet: false },
      ],
    });
    expect(await previewFreeSource(1, deps)).toMatchObject({ privateUnmet: 0 });
  });
  it("only applies to a finished re-encode", async () => {
    const { deps } = freeDeps({
      loadJob: async () => ({ status: "failed", mediaId: 5, episodeId: null }),
    });
    expect(await previewFreeSource(1, deps)).toEqual({ status: "not_done" });
  });
});

function discardDeps(over: Partial<DiscardDeps> = {}) {
  const calls: string[] = [];
  const deps: DiscardDeps = {
    loadJob: async () => ({
      status: "failed",
      mediaFileId: 3,
      filePath: "/lib/a.mkv",
    }),
    encodingFileId: () => null,
    fs: {
      size: async (p) => (p === "/lib/.a.rawkoon-tmp.mkv" ? 500 : null),
      unlink: async (p) => {
        calls.push(`unlink ${p}`);
      },
    },
    mapPath: (p) => p,
    deleteRow: async (id) => {
      calls.push(`delete ${id}`);
    },
    ...over,
  };
  return { deps, calls };
}

describe("discardFailedJob", () => {
  it("removes the partial output and the history row", async () => {
    const { deps, calls } = discardDeps();
    expect(await discardFailedJob(9, deps)).toEqual({
      status: "ok",
      freedBytes: 500,
    });
    expect(calls).toEqual(["unlink /lib/.a.rawkoon-tmp.mkv", "delete 9"]);
  });
  it("still deletes the row when there is no partial output", async () => {
    const { deps, calls } = discardDeps({
      fs: { size: async () => null, unlink: async () => {} },
    });
    expect(await discardFailedJob(9, deps)).toEqual({
      status: "ok",
      freedBytes: 0,
    });
    expect(calls).toEqual(["delete 9"]);
  });
  it("refuses a job that is not failed or cancelled", async () => {
    for (const status of ["done", "queued", "running"]) {
      const { deps, calls } = discardDeps({
        loadJob: async () => ({
          status,
          mediaFileId: 3,
          filePath: "/lib/a.mkv",
        }),
      });
      expect(await discardFailedJob(9, deps)).toEqual({ status: "not_failed" });
      expect(calls).toEqual([]);
    }
  });
  it("leaves the temp file alone while another job encodes that file", async () => {
    const { deps, calls } = discardDeps({ encodingFileId: () => 3 });
    expect(await discardFailedJob(9, deps)).toEqual({ status: "busy" });
    expect(calls).toEqual([]);
  });
  it("answers not_found for an unknown job", async () => {
    const { deps } = discardDeps({ loadJob: async () => null });
    expect(await discardFailedJob(9, deps)).toEqual({ status: "not_found" });
  });
});
