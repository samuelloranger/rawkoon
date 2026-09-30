import { describe, expect, it } from "bun:test";
import {
  type DiscardDeps,
  discardFailedJob,
  type FreeSourceDeps,
  freeSeededSource,
} from "@rawkoon/api/services/transcode/jobCleanup";

function freeDeps(over: Partial<FreeSourceDeps> = {}) {
  const released: string[] = [];
  const deps: FreeSourceDeps = {
    loadJob: async () => ({ status: "done", mediaId: 5, episodeId: null }),
    heldHashes: async () => ["aa", "bb"],
    release: async (hash) => {
      released.push(hash);
      return { status: "released", freedBytes: 100 };
    },
    ...over,
  };
  return { deps, released };
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
