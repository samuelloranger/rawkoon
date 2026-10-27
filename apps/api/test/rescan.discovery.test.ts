import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import {
  state,
  statMap,
  scanMap,
  readdirMap,
  makeMi,
  makeFile,
  resetRescanState,
  installRescanMocks,
} from "./mocks/rescanHarness";

await installRescanMocks();

// Import the service AFTER mock registrations
const { rescanLibraryItem } = await import("../src/services/library/rescan");

beforeEach(resetRescanState);

describe("Discovery (Step 1b)", () => {
  it("28. Movie, matching file on disk not yet tracked → imported:1, mediaFile.create called", async () => {
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
    readdirMap["/movies"] = ["The Matrix (1999) [1080p BluRay].mkv"];
    scanMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = makeMi();
    statMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = true;

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(1);
    expect(state.createdFiles).toHaveLength(1);
  });

  it("29. File on disk with wrong title → not imported", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 0;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    readdirMap["/movies"] = ["Unrelated Movie (2005) [1080p].mkv"];
    scanMap["/movies/Unrelated Movie (2005) [1080p].mkv"] = makeMi();

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    expect(state.createdFiles).toHaveLength(0);
  });

  it("30. Matching file on disk but scanMediaInfo returns null → not imported", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 0;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    readdirMap["/movies"] = ["The Matrix (1999) [1080p BluRay].mkv"];
    scanMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = null;
    statMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = true;

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    expect(state.createdFiles).toHaveLength(0);
  });

  it("31. Importing a file updates media status from 'wanted' to 'downloaded'", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "wanted",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 0;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "hardlink",
    };
    readdirMap["/movies"] = ["The Matrix (1999) [1080p BluRay].mkv"];
    scanMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = makeMi();
    statMap["/movies/The Matrix (1999) [1080p BluRay].mkv"] = true;

    await rescanLibraryItem(1);
    expect(state.allMediaUpdateArgs).toContainEqual(
      expect.objectContaining({ data: { status: "downloaded" } }),
    );
  });

  it("32. File path already tracked in media_files → not re-imported", async () => {
    const existingFile = makeFile({
      id: 1,
      filePath: "/movies/The Matrix (1999) [1080p BluRay].mkv",
      fileName: "The Matrix (1999) [1080p BluRay].mkv",
    });
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.files = [existingFile];
    state.remainingFileCount = 1;
    statMap[existingFile.filePath] = true;
    scanMap[existingFile.filePath] = makeMi();
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "none", // skip rename so only import is tested
    };
    readdirMap["/movies"] = ["The Matrix (1999) [1080p BluRay].mkv"];

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
    expect(state.createdFiles).toHaveLength(0);
  });

  it("33. Non-video file extension in library dir → skipped", async () => {
    state.media = {
      id: 1,
      type: "movie",
      status: "downloaded",
      title: "The Matrix",
      year: 1999,
    };
    state.remainingFileCount = 0;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "none",
    };
    readdirMap["/movies"] = ["The Matrix (1999).nfo", "The Matrix (1999).srt"];

    const result = await rescanLibraryItem(1);
    expect(result?.imported).toBe(0);
  });

  function discoverMovie(title: string, year: number, files: string[]) {
    state.media = { id: 1, type: "movie", status: "downloaded", title, year };
    state.remainingFileCount = 1;
    state.mediaSettings = {
      moviesLibraryPath: "/movies",
      showsLibraryPath: null,
      movieTemplate: "{title} ({year})",
      episodeTemplate: "",
      fileOperation: "none",
    };
    readdirMap["/movies"] = files;
    for (const name of files) {
      scanMap[`/movies/${name}`] = makeMi();
      statMap[`/movies/${name}`] = true;
    }
    return rescanLibraryItem(1);
  }

  it("33b. Accented short title only matches its own file, not every same-year file", async () => {
    const result = await discoverMovie("Ça", 2017, [
      "Ça (2017) [1080p WEB].mkv",
      "Logan (2017) [1080p WEB].mkv",
      "Wonder Woman (2017) [2160p BluRay].mkv",
    ]);
    expect(result?.imported).toBe(1);
    expect(state.createdFiles).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: "Ça (2017) [1080p WEB].mkv",
        }),
      }),
    ]);
  });

  it("33b2. Ligature in the title matches its spelled-out filename", async () => {
    const result = await discoverMovie("Cœur", 2019, [
      "Coeur (2019) [1080p WEB].mkv",
    ]);
    expect(result?.imported).toBe(1);
  });

  it("33c. Title only matches whole words", async () => {
    const result = await discoverMovie("It", 2017, [
      "Kitten Heist (2017) [1080p WEB].mkv",
    ]);
    expect(result?.imported).toBe(0);
  });

  it("33d. Title with no Latin letters or digits skips discovery", async () => {
    const result = await discoverMovie("君の名は", 2016, [
      "Your Name (2016) [1080p BluRay].mkv",
    ]);
    expect(result?.imported).toBe(0);
  });

  it("33e. File already tracked by another library item → not imported", async () => {
    state.otherOwnedPaths = ["/movies/The Matrix (1999) [1080p BluRay].mkv"];
    const result = await discoverMovie("The Matrix", 1999, [
      "The Matrix (1999) [1080p BluRay].mkv",
    ]);
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
