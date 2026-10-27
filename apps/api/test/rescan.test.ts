import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import {
  state,
  statMap,
  scanMap,
  qbCompleteHashes,
  remap,
  makeMi,
  makeFile,
  resetRescanState,
  installRescanMocks,
} from "./mocks/rescanHarness";

await installRescanMocks();

// Import the service AFTER mock registrations
const { rescanLibraryItem } = await import("../src/services/library/rescan");

beforeEach(resetRescanState);

describe("rescanLibraryItem", () => {
  it("1. Media not found → returns null", async () => {
    state.media = null;
    const result = await rescanLibraryItem(999);
    expect(result).toBeNull();
  });

  it("2. Movie, no files, status 'wanted' → no DB writes", async () => {
    state.media = { id: 1, type: "movie", status: "wanted" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result).toEqual({
      rescanned: 0,
      skipped: 0,
      failed: 0,
      deleted: 0,
      imported: 0,
      renamed: 0,
      requeued: 0,
      episodesReset: 0,
      mediaReset: false,
      pendingReconciled: { completed: 0, failed: 0, missing: 0 },
    });
    expect(state.mediaUpdateArgs).toBeNull();
  });

  it("3. Movie, no files, status 'downloading' → resets media to 'wanted'", async () => {
    state.media = { id: 1, type: "movie", status: "downloading" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(true);
    expect(state.mediaUpdateArgs).toBeTruthy();
  });

  it("4. Movie, no files, status 'downloaded' → resets media to 'wanted'", async () => {
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(true);
  });

  it("5. Movie, no files, status 'skipped' → does NOT reset media", async () => {
    state.media = { id: 1, type: "movie", status: "skipped" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(false);
    expect(state.mediaUpdateArgs).toBeNull();
  });

  it("6. Movie, 1 file on disk, MediaInfo succeeds → rescanned:1", async () => {
    const file = makeFile({ id: 1, filePath: "/media/movie.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();

    const result = await rescanLibraryItem(1);
    expect(result?.rescanned).toBe(1);
    expect(result?.skipped).toBe(0);
    expect(result?.failed).toBe(0);
    expect(result?.deleted).toBe(0);
    expect(state.updatedFileIds).toContain(1);
    expect(result?.mediaReset).toBe(false);
  });

  it("6b. Unchanged fingerprint skips MediaInfo → skipped:1, rescanned:0", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/media/movie.mkv",
      sizeBytes: 1_000_000n,
      fileMtimeMs: 1_700_000_000_000n,
      fileDev: 1n,
      fileIno: 42n,
      resolution: 1080,
      source: "BluRay",
      videoCodec: "x264",
    });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    // MediaInfo would fail if called — skip must not invoke it.
    scanMap[file.filePath] = null;
    statMap[file.filePath] = {
      size: 1_000_000,
      mtimeMs: 1_700_000_000_000,
      dev: 1,
      ino: 42,
    };

    const result = await rescanLibraryItem(1);
    expect(result?.skipped).toBe(1);
    expect(result?.rescanned).toBe(0);
    expect(result?.failed).toBe(0);
    expect(result?.deleted).toBe(0);
    expect(state.updatedFileIds).toHaveLength(0);
    expect(result?.mediaReset).toBe(false);
  });

  it("7. Movie, file on disk but MediaInfo null → failed:1, record kept, status unchanged", async () => {
    const file = makeFile({ id: 1, filePath: "/media/corrupt.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = null;

    const result = await rescanLibraryItem(1);
    expect(result?.failed).toBe(1);
    expect(result?.deleted).toBe(0);
    expect(result?.rescanned).toBe(0);
    expect(result?.mediaReset).toBe(false);
    expect(state.deletedFileIds).toHaveLength(0);
  });

  it("8. Movie, file deleted from disk → deletes record, resets media to 'wanted'", async () => {
    const file = makeFile({ id: 1, filePath: "/media/gone.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    scanMap[file.filePath] = null;
    // stat will throw (not in statMap)

    const result = await rescanLibraryItem(1);
    expect(result?.deleted).toBe(1);
    expect(result?.failed).toBe(0);
    expect(state.deletedFileIds).toContain(1);
    expect(result?.mediaReset).toBe(true);
  });

  it("9. Movie, 2 files: 1 valid + 1 deleted → rescanned:1, deleted:1, media stays 'downloaded'", async () => {
    const file1 = makeFile({ id: 1, filePath: "/media/part1.mkv" });
    const file2 = makeFile({ id: 2, filePath: "/media/part2.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file1, file2];
    statMap[file1.filePath] = true;
    scanMap[file1.filePath] = makeMi();
    scanMap[file2.filePath] = null; // part2 gone, stat will throw

    const result = await rescanLibraryItem(1);
    expect(result?.rescanned).toBe(1);
    expect(result?.deleted).toBe(1);
    expect(result?.mediaReset).toBe(false); // 1 file still remains
  });

  it("10. Show, no files, 3 episodes 'downloaded' → episodesReset:3", async () => {
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.remainingFileCount = 0;
    state.episodeUpdateManyCount = 3;

    const result = await rescanLibraryItem(1);
    expect(result?.episodesReset).toBe(3);
    expect(state.episodeUpdateManyArgs).toBeTruthy();
  });

  it("11. Show, no files, media 'downloaded' → resets media to 'wanted'", async () => {
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(true);
  });

  it("12. Show, no files, 'skipped' episodes are excluded from reset", async () => {
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.remainingFileCount = 0;
    state.episodeUpdateManyCount = 0;

    await rescanLibraryItem(1);

    const args = state.episodeUpdateManyArgs as {
      where: { status: { notIn: string[] } };
    };
    expect(args.where.status.notIn).toContain("skipped");
  });

  it("13. Show, episodes already 'wanted' → updateMany where clause excludes 'wanted' (idempotent)", async () => {
    state.media = { id: 1, type: "show", status: "wanted" };
    state.remainingFileCount = 0;
    state.episodeUpdateManyCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.episodesReset).toBe(0);
    const args = state.episodeUpdateManyArgs as {
      where: { status: { notIn: string[] } };
    };
    expect(args.where.status.notIn).toContain("wanted");
  });

  it("14. Show, 1 file still present → media NOT reset to 'wanted'", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/media/show/s01e01.mkv",
      episodeId: 10,
    });
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();

    const result = await rescanLibraryItem(1);
    expect(result?.mediaReset).toBe(false);
    expect(state.mediaUpdateArgs).toBeNull();
  });

  it("15. Show, all files deleted → deleted:N, episodes reset, media reset", async () => {
    const files = [
      makeFile({ id: 1, filePath: "/media/s01e01.mkv", episodeId: 1 }),
      makeFile({ id: 2, filePath: "/media/s01e02.mkv", episodeId: 2 }),
      makeFile({ id: 3, filePath: "/media/s01e03.mkv", episodeId: 3 }),
    ];
    state.media = { id: 1, type: "show", status: "downloaded" };
    state.files = files;
    state.episodeUpdateManyCount = 3;
    for (const f of files) scanMap[f.filePath] = null; // all gone

    const result = await rescanLibraryItem(1);
    expect(result?.deleted).toBe(3);
    expect(result?.failed).toBe(0);
    expect(result?.episodesReset).toBe(3);
    expect(result?.mediaReset).toBe(true);
  });

  it("16. File exists on disk but MediaInfo null → failed:1, deleted:0, status unchanged", async () => {
    const file = makeFile({ id: 1, filePath: "/media/corrupt.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = null;

    const result = await rescanLibraryItem(1);
    expect(result?.failed).toBe(1);
    expect(result?.deleted).toBe(0);
    expect(result?.mediaReset).toBe(false);
    expect(state.mediaUpdateArgs).toBeNull();
  });

  it("17. imported is always 0 (use Library → Downloads to add files manually)", async () => {
    state.media = { id: 1, type: "movie", status: "downloading" };
    state.remainingFileCount = 1;

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    // With no tracked files remaining, reconcile still runs (handled by steps 18+)
    expect(result?.rescanned).toBe(0);
  });

  it("18. Tracked files rescanned regardless of obsolete import semantics", async () => {
    const file = makeFile({ id: 1, filePath: "/media/movie.mkv" });
    state.media = { id: 1, type: "movie", status: "downloading" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    expect(result?.rescanned).toBe(1);
    expect(result?.mediaReset).toBe(false);
  });

  it("19. Completed DH with torrent still in qBittorrent (completed state) → requeued:1", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloading",
      downloadHistories: [{ id: 42, torrentHash: "abc123", episodeId: null }],
    };
    state.remainingFileCount = 0;
    qbCompleteHashes.add("abc123"); // torrent present and completed in qB

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(1);
    expect(state.enqueuedDhIds).toContain(42);
    // Status reconciliation skipped because requeued > 0
    expect(result?.mediaReset).toBe(false);
    expect(state.mediaUpdateArgs).toBeNull();
  });

  it("20. Completed DH but torrent NOT in qBittorrent → requeued:0, status reset to 'wanted'", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloading",
      downloadHistories: [{ id: 42, torrentHash: "abc123", episodeId: null }],
    };
    state.remainingFileCount = 0;
    // qbCompleteHashes is empty → torrent not found

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(0);
    expect(state.enqueuedDhIds).toHaveLength(0);
    // Status reconciliation runs → resets to wanted
    expect(result?.mediaReset).toBe(true);
  });

  it("21. Show: episode DH in qBittorrent but that episode already has a file → not re-queued", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/media/s01e01.mkv",
      episodeId: 10,
    });
    state.media = {
      id: 1,
      type: "show",
      status: "downloaded",
      downloadHistories: [{ id: 55, torrentHash: "ep10hash", episodeId: 10 }],
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    qbCompleteHashes.add("ep10hash"); // torrent present but episode already imported

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(0); // episode 10 has a file → no requeue
    expect(state.enqueuedDhIds).toHaveLength(0);
  });

  it("22. Show: episode DH in qBittorrent, file missing → re-queued, reconciliation skipped", async () => {
    state.media = {
      id: 1,
      type: "show",
      status: "downloading",
      downloadHistories: [{ id: 77, torrentHash: "ephash", episodeId: 20 }],
    };
    state.remainingFileCount = 0;
    qbCompleteHashes.add("ephash"); // torrent present, episode 20 has no file

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(1);
    expect(state.enqueuedDhIds).toContain(77);
    expect(result?.episodesReset).toBe(0); // skipped
    expect(result?.mediaReset).toBe(false); // skipped
  });

  it("24. remapPath identity (no env vars) → statFile receives original path, file found → failed:1", async () => {
    // remapFn is identity by default — verifies existing tests still hold
    const file = makeFile({ id: 1, filePath: "/library/show.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap["/library/show.mkv"] = true; // file exists at raw path
    scanMap[file.filePath] = null; // MediaInfo fails

    const result = await rescanLibraryItem(1);
    expect(result?.failed).toBe(1);
    expect(result?.deleted).toBe(0);
  });

  it("25. remapPath active → statFile uses remapped path, file found there → failed:1 not deleted:1", async () => {
    // Simulates: MEDIA_PATH_FROM=/data/library MEDIA_PATH_TO=/mnt/library
    remap.fn = (p) => p.replace("/data/library/", "/mnt/library/");

    const file = makeFile({ id: 1, filePath: "/data/library/show.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.remainingFileCount = 1;
    // File does NOT exist at raw path — only at the remapped path
    statMap["/mnt/library/show.mkv"] = true;
    scanMap[file.filePath] = null; // MediaInfo fails (same path scanMediaInfo uses)

    const result = await rescanLibraryItem(1);
    // statFile uses remapped path → file found → failed, not deleted
    expect(result?.failed).toBe(1);
    expect(result?.deleted).toBe(0);
    expect(state.deletedFileIds).toHaveLength(0);
  });

  it("26. remapPath active → statFile uses remapped path, file absent at remapped path → deleted:1", async () => {
    remap.fn = (p) => p.replace("/data/library/", "/mnt/library/");

    const file = makeFile({ id: 1, filePath: "/data/library/gone.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    scanMap[file.filePath] = null;
    // statMap has neither raw nor remapped path → stat throws

    const result = await rescanLibraryItem(1);
    // statFile uses remapped path → file not found → record deleted
    expect(result?.deleted).toBe(1);
    expect(result?.failed).toBe(0);
    expect(state.deletedFileIds).toContain(1);
  });

  it("23. DH has null torrentHash → never re-queued regardless of qBittorrent state", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloading",
      downloadHistories: [{ id: 99, torrentHash: null, episodeId: null }],
    };
    state.remainingFileCount = 0;

    const result = await rescanLibraryItem(1);
    expect(result?.requeued).toBe(0);
    expect(state.enqueuedDhIds).toHaveLength(0);
    // Falls through to status reset
    expect(result?.mediaReset).toBe(true);
  });
});

it("27. RescanResult includes renamed field", async () => {
  state.media = { id: 1, type: "movie", status: "downloaded" };
  state.remainingFileCount = 0;

  const result = await rescanLibraryItem(1);
  expect(result).toHaveProperty("renamed");
  expect(result?.renamed).toBe(0);
});

// Restore node:fs/promises so the mock doesn't leak into other test files that
// run in the same worker context (e.g. downloadsAssign.test.ts).
afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mock.module("node:fs/promises", () => require("node:fs").promises);
});
