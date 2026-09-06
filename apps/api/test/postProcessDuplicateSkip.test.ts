import { describe, it, expect, beforeEach, mock } from "bun:test";
import * as realFs from "node:fs/promises";

/**
 * Regression (board task 723): a second grab for an item whose file another
 * grab already imported post-processed "successfully" but imported nothing.
 *
 * The pre-scan short-circuit in postProcessorSingle / postProcessorBook finds
 * the winning grab's file on disk, marks the item downloaded, sets
 * postProcessDestinationPath, clears postProcessError, and returns success —
 * with NO placeFile and NO new media_files/book_files row. That silent no-op
 * looked identical to a real import.
 *
 * Fix (option 3): keep success semantics but RECORD the skip in a dedicated
 * postProcessSkipReason field (NOT postProcessError, which drives failure
 * notifications) and surface it through the outcome so the "downloaded"
 * notification is suppressed for a duplicate.
 */

type Dh = Record<string, unknown> & { media?: unknown; episode?: unknown };

const state: {
  dh: Dh | null;
  settings: Record<string, unknown> | null;
  mediaFiles: { id: number; filePath: string }[];
  bookFiles: { filePath: string }[];
  dhUpdates: Record<string, unknown>[];
  mediaFileCreates: unknown[];
  bookFileCreates: unknown[];
} = {
  dh: null,
  settings: null,
  mediaFiles: [],
  bookFiles: [],
  dhUpdates: [],
  mediaFileCreates: [],
  bookFileCreates: [],
};

// Every existing file the pre-scan stat()s is on disk.
mock.module("node:fs/promises", () => ({
  ...realFs,
  stat: async () => ({ isFile: () => true }),
  unlink: async () => {},
  link: async () => {},
  rename: async () => {},
  copyFile: async () => {},
  mkdir: async () => {},
  readdir: async () => [],
  rm: async () => {},
  readFile: async () => Buffer.from(""),
  writeFile: async () => {},
  access: async () => {},
}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findUnique: async () => state.dh,
      update: async (args: { data: Record<string, unknown> }) => {
        state.dhUpdates.push(args.data);
        return { id: 1 };
      },
    },
    mediaSettings: { findUnique: async () => state.settings },
    mediaFile: {
      findMany: async () => state.mediaFiles,
      findFirst: async () => null,
      create: async (args: unknown) => {
        state.mediaFileCreates.push(args);
        return { id: 999 };
      },
      update: async () => ({ id: 1 }),
    },
    libraryMedia: { update: async () => ({ id: 1 }) },
    libraryEpisode: { update: async () => ({ id: 1 }) },
    bookFile: {
      findMany: async () => state.bookFiles,
      create: async (args: unknown) => {
        state.bookFileCreates.push(args);
        return { id: 999 };
      },
    },
    bookEdition: {
      update: async () => ({ id: 1, bookId: 7 }),
      findUnique: async () => ({ bookId: 7 }),
    },
  },
}));

const { postProcess } = await import(
  "@rawkoon/api/services/postProcessorSingle"
);
const { postProcessBookDownload } = await import(
  "@rawkoon/api/services/postProcessorBook"
);

beforeEach(() => {
  state.dh = null;
  state.settings = null;
  state.mediaFiles = [];
  state.bookFiles = [];
  state.dhUpdates = [];
  state.mediaFileCreates = [];
  state.bookFileCreates = [];
});

describe("postProcessorSingle duplicate pre-scan skip", () => {
  it("records a skip reason and imports nothing when another grab already placed the file", async () => {
    state.dh = {
      id: 1,
      isUpgrade: false,
      failed: false,
      completedAt: new Date(),
      torrentHash: "deadbeef",
      releaseTitle: "Some.Movie.2026.1080p.WEB.H264-BBB",
      qualityParsed: null,
      episode: null,
      media: {
        id: 42,
        type: "movie",
        title: "Some Movie",
        year: 2026,
        tmdbStatus: null,
      },
    };
    state.settings = {
      postProcessingEnabled: true,
      fileOperation: "hardlink",
      moviesLibraryPath: "/movies",
      minSeedRatio: 0,
    };
    // The winning grab's already-imported MediaFile, on disk.
    state.mediaFiles = [{ id: 5, filePath: "/movies/Some Movie (2026).mkv" }];

    const result = await postProcess(1);

    expect(result.success).toBe(true);
    expect(result.success && result.skipped).toBe(true);
    expect(result.success && result.skipReason).toBe(
      "duplicate-already-imported",
    );

    const skipWrite = state.dhUpdates.find(
      (d) => d.postProcessSkipReason === "duplicate-already-imported",
    );
    expect(skipWrite).toBeDefined();
    expect(skipWrite?.postProcessError).toBeNull();
    expect(skipWrite?.postProcessDestinationPath).toBe(
      "/movies/Some Movie (2026).mkv",
    );

    // The whole point: nothing was imported.
    expect(state.mediaFileCreates).toHaveLength(0);
  });
});

describe("postProcessorBook duplicate pre-scan skip", () => {
  it("records a skip reason and imports nothing when the edition's file is already on disk", async () => {
    state.dh = {
      id: 2,
      bookEditionId: 5,
      isUpgrade: false,
      failed: false,
      completedAt: new Date(),
      torrentHash: "cafef00d",
      releaseTitle: "Some Book (2026) [epub]",
    };
    state.settings = { postProcessingEnabled: true };
    state.bookFiles = [{ filePath: "/books/Some Book/Some Book.epub" }];

    const result = await postProcessBookDownload(2);

    expect(result.success).toBe(true);
    expect(result.success && result.skipped).toBe(true);
    expect(result.success && result.skipReason).toBe(
      "duplicate-already-imported",
    );

    const skipWrite = state.dhUpdates.find(
      (d) => d.postProcessSkipReason === "duplicate-already-imported",
    );
    expect(skipWrite).toBeDefined();
    expect(skipWrite?.postProcessError).toBeNull();

    expect(state.bookFileCreates).toHaveLength(0);
  });
});
