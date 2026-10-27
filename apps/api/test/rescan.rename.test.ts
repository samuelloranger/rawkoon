import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import {
  state,
  statMap,
  scanMap,
  readdirMap,
  renameCaptures,
  makeMi,
  makeFile,
  resetRescanState,
  installRescanMocks,
} from "./mocks/rescanHarness";

await installRescanMocks();

// Import the service AFTER mock registrations
const { rescanLibraryItem } = await import("../src/services/library/rescan");

beforeEach(resetRescanState);

describe("Rename (Step 1c)", () => {
  it("34. File name doesn't match template → renamed:1, fs.rename called, DB updated", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 1080,
      source: "BluRay",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(1);
    expect(renameCaptures).toHaveLength(1);
    expect(renameCaptures[0].from).toBe("/movies/matrix.mkv");
    expect(renameCaptures[0].to).toBe(
      "/movies/The Matrix (1999) [1080p BluRay].mkv",
    );
  });

  it("35. File name already matches template → renamed:0", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/The Matrix (1999) [1080p BluRay].mkv",
      fileName: "The Matrix (1999) [1080p BluRay].mkv",
      resolution: 1080,
      source: "BluRay",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(0);
    expect(renameCaptures).toHaveLength(0);
  });

  it("36. file_operation is 'none' → no rename attempted", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 1080,
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "none",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(0);
    expect(renameCaptures).toHaveLength(0);
  });

  it("37. Active download in progress → rename skipped", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 1080,
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloading",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi();
    state.activeDownloadCount = 1;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(0);
    expect(renameCaptures).toHaveLength(0);
  });

  it("38. Rename target already exists on disk → skipped (no overwrite)", async () => {
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 1080,
      source: "BluRay",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    // Target name already exists on disk (e.g. a stale leftover)
    statMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = true;
    scanMap[file.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(0);
    expect(renameCaptures).toHaveLength(0);
  });

  it("39. Two files resolving to same template stem → only first renames", async () => {
    const file1 = makeFile({
      id: 1,
      filePath: "/movies/matrix-a.mkv",
      fileName: "matrix-a.mkv",
      resolution: 1080,
      source: "BluRay",
    });
    const file2 = makeFile({
      id: 2,
      filePath: "/movies/matrix-b.mkv",
      fileName: "matrix-b.mkv",
      resolution: 1080,
      source: "BluRay",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file1, file2];
    state.remainingFileCount = 2;
    statMap[file1.filePath] = true;
    statMap[file2.filePath] = true;
    scanMap[file1.filePath] = makeMi();
    scanMap[file2.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(1);
    expect(renameCaptures).toHaveLength(1);
    expect(renameCaptures[0].from).toBe("/movies/matrix-a.mkv");
  });

  it("40. Rename uses fresh MediaInfo, not stale file row", async () => {
    // DB row says 720p WEB, but MediaInfo rescan reveals 1080p BluRay.
    // Template should be built from the fresh values.
    const file = makeFile({
      id: 1,
      filePath: "/movies/matrix.mkv",
      fileName: "matrix.mkv",
      resolution: 720,
      source: "WEB",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [file];
    state.remainingFileCount = 1;
    statMap[file.filePath] = true;
    scanMap[file.filePath] = makeMi({ resolution: 1080, source: "BluRay" });
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };

    const result = await rescanLibraryItem(1);
    expect(result?.renamed).toBe(1);
    expect(renameCaptures[0].to).toBe(
      "/movies/The Matrix (1999) [1080p BluRay].mkv",
    );
  });

  it("30. A file mid re-encode swap is neither rescanned nor deleted", async () => {
    const file = makeFile({ id: 1, filePath: "/media/busy.mkv" });
    state.media = { id: 1, type: "movie", status: "downloaded" };
    state.files = [file];
    state.activeTranscodeFileIds = [1];
    scanMap[file.filePath] = null;

    const result = await rescanLibraryItem(1);
    expect(result?.deleted).toBe(0);
    expect(state.deletedFileIds).toHaveLength(0);
  });

  it("31. Re-encode working files on disk are never imported", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 1;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year}) [{resolution} {source}]",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    const tmpName = ".The Matrix (1999) [1080p BluRay].rawkoon-tmp.mkv";
    readdirMap["/movies"] = [tmpName];
    scanMap[`/movies/${tmpName}`] = makeMi();
    statMap[`/movies/${tmpName}`] = true;

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    expect(state.createdFiles).toHaveLength(0);
  });
});

// Restore node:fs/promises so the mock doesn't leak into other test files that
// run in the same worker context (e.g. downloadsAssign.test.ts).
afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mock.module("node:fs/promises", () => require("node:fs").promises);
});
