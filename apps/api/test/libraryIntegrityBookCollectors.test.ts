import { describe, it, expect, beforeEach, mock } from "bun:test";
import * as realFs from "node:fs/promises";

// The health page is the only place that tells an admin a book is downloaded
// but unreadable. Two behaviours matter: an edition marked downloaded with no
// BookFile rows, and a BookFile whose path has vanished from disk. Both are
// skipped entirely when books are disabled, so a movies-only install neither
// pays for the scan nor sees book rows it has no pages for.

const state: {
  booksEnabled: boolean;
  editions: Array<{
    id: number;
    kind: string;
    book: { id: number; title: string };
    _count: { files: number };
  }>;
  files: Array<{
    id: number;
    filePath: string;
    edition: { id: number; kind: string; book: { id: number; title: string } };
  }>;
  existingPaths: Set<string>;
  editionQueries: number;
  fileQueries: number;
} = {
  booksEnabled: true,
  editions: [],
  files: [],
  existingPaths: new Set(),
  editionQueries: 0,
  fileQueries: 0,
};

/** Paged collectors stop on an empty page; serve the rows once, then nothing. */
function pageOnce<T>(rows: T[], args: { cursor?: unknown }): Promise<T[]> {
  return Promise.resolve(args.cursor ? [] : rows);
}

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    appSettings: {
      findUnique: () => Promise.resolve({ booksEnabled: state.booksEnabled }),
    },
    bookEdition: {
      findMany: (args: { cursor?: unknown }) => {
        state.editionQueries += 1;
        return pageOnce(state.editions, args);
      },
    },
    bookFile: {
      findMany: (args: { cursor?: unknown }) => {
        state.fileQueries += 1;
        return pageOnce(state.files, args);
      },
    },
  },
}));

function installIntegrityFsMock() {
  mock.module("node:fs/promises", () => ({
    ...realFs,
    access: (path: string) =>
      state.existingPaths.has(path)
        ? Promise.resolve(undefined)
        : Promise.reject(new Error("ENOENT")),
  }));
}
installIntegrityFsMock();

const {
  collectDownloadedBookEditionsWithoutFiles,
  collectMissingBookFilePaths,
} = await import("@rawkoon/api/services/libraryIntegrityCollectors");

describe("collectDownloadedBookEditionsWithoutFiles", () => {
  beforeEach(() => {
    state.booksEnabled = true;
    state.editionQueries = 0;
    state.editions = [
      {
        id: 11,
        kind: "ebook",
        book: { id: 7, title: "La prof" },
        _count: { files: 0 },
      },
      {
        id: 12,
        kind: "audiobook",
        book: { id: 7, title: "La prof" },
        _count: { files: 2 },
      },
    ];
  });

  it("flags a downloaded edition that has no BookFile rows", async () => {
    const issues = await collectDownloadedBookEditionsWithoutFiles();

    expect(issues.length).toBe(1);
    expect(issues[0]).toMatchObject({
      kind: "downloaded_book_edition_without_files",
      book_id: 7,
      book_edition_id: 11,
      edition_kind: "ebook",
      title: "La prof",
    });
    expect(issues[0]!.detail).toContain("La prof");
  });

  it("returns nothing and skips the scan when books are disabled", async () => {
    state.booksEnabled = false;

    const issues = await collectDownloadedBookEditionsWithoutFiles();

    expect(issues).toEqual([]);
    expect(state.editionQueries).toBe(0);
  });
});

describe("collectMissingBookFilePaths", () => {
  beforeEach(() => {
    state.booksEnabled = true;
    state.fileQueries = 0;
    state.existingPaths = new Set(["/books/present.epub"]);
    state.files = [
      {
        id: 21,
        filePath: "/books/present.epub",
        edition: {
          id: 11,
          kind: "ebook",
          book: { id: 7, title: "La prof" },
        },
      },
      {
        id: 22,
        filePath: "/books/gone.epub",
        edition: {
          id: 11,
          kind: "ebook",
          book: { id: 7, title: "La prof" },
        },
      },
    ];
  });

  it("flags only the file whose path is gone", async () => {
    const issues = await collectMissingBookFilePaths();

    expect(issues.length).toBe(1);
    expect(issues[0]).toMatchObject({
      kind: "missing_book_file_path",
      book_id: 7,
      book_edition_id: 11,
      book_file_id: 22,
      edition_kind: "ebook",
      title: "La prof",
      path: "/books/gone.epub",
    });
  });

  it("returns nothing and skips the scan when books are disabled", async () => {
    state.booksEnabled = false;

    const issues = await collectMissingBookFilePaths();

    expect(issues).toEqual([]);
    expect(state.fileQueries).toBe(0);
  });
});
