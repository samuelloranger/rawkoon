import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// An upgrade import has to delete what it replaced. Without that the edition
// holds both formats, its aggregated size counts both, and the library grows on
// every improvement — so the upgrade pass would make things worse, not better.

const root = await mkdtemp(join(tmpdir(), "rawkoon-book-upgrade-"));
const downloads = join(root, "downloads");
const booksRoot = join(root, "Books");

type FileRow = { id: number; editionId: number; filePath: string };

const state: {
  files: FileRow[];
  nextId: number;
  deletedIds: number[];
  created: string[];
  editionUpdates: Array<Record<string, unknown>>;
} = {
  files: [],
  nextId: 100,
  deletedIds: [],
  created: [],
  editionUpdates: [],
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookEdition: {
      findUnique: () =>
        Promise.resolve({
          id: 1,
          bookId: 9,
          kind: "ebook",
          book: {
            title: "A Quiet Harbour",
            authors: ["Camille Rousseau"],
            language: "fr",
            publishedYear: 2019,
          },
          bookQualityProfile: { allowedFormats: ["epub", "pdf"] },
        }),
      update: (args: { data: Record<string, unknown> }) => {
        state.editionUpdates.push(args.data);
        return Promise.resolve({ bookId: 9 });
      },
    },
    mediaSettings: {
      upsert: () =>
        Promise.resolve({
          booksLibraryPath: booksRoot,
          audiobooksLibraryPath: join(root, "Audiobooks"),
          bookTemplate: "{author}/{title} ({year})/{title} ({year}) [{format}]",
          audiobookTemplate: "{author}/{title} ({year})/{title}",
        }),
    },
    bookFile: {
      findMany: (args: { where: { filePath?: { notIn?: string[] } } }) => {
        const notIn = args.where.filePath?.notIn;
        return Promise.resolve(
          notIn
            ? state.files.filter((f) => !notIn.includes(f.filePath))
            : state.files,
        );
      },
      deleteMany: (args: {
        where: { filePath?: string; id?: { in: number[] } };
      }) => {
        const before = state.files.length;
        if (args.where.id?.in) {
          state.deletedIds.push(...args.where.id.in);
          state.files = state.files.filter(
            (f) => !args.where.id!.in.includes(f.id),
          );
        } else if (args.where.filePath) {
          state.files = state.files.filter(
            (f) => f.filePath !== args.where.filePath,
          );
        }
        return Promise.resolve({ count: before - state.files.length });
      },
      create: (args: { data: Record<string, unknown> }) => {
        const row = {
          id: state.nextId++,
          editionId: args.data.editionId as number,
          filePath: args.data.filePath as string,
        };
        state.created.push(row.filePath);
        state.files.push(row);
        return Promise.resolve(row);
      },
    },
  },
}));

const realEbookMetadata = await import(
  "@rawkoon/api/utils/books/ebookMetadata"
);
mock.module("@rawkoon/api/utils/books/ebookMetadata", () => ({
  ...realEbookMetadata,
  readEbookMetadata: () => Promise.resolve({ language: "fr" }),
}));

const { postProcessBook } = await import(
  "@rawkoon/api/services/postProcessorBook"
);

const libraryDir = join(
  booksRoot,
  "Camille Rousseau",
  "A Quiet Harbour (2019)",
);
const oldPath = join(libraryDir, "A Quiet Harbour (2019) [pdf].pdf");

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

describe("postProcessBook upgrades", () => {
  beforeEach(async () => {
    await rm(downloads, { recursive: true, force: true });
    await rm(booksRoot, { recursive: true, force: true });
    await mkdir(downloads, { recursive: true });
    await mkdir(libraryDir, { recursive: true });
    await writeFile(oldPath, "old pdf");
    state.files = [{ id: 1, editionId: 1, filePath: oldPath }];
    state.nextId = 100;
    state.deletedIds = [];
    state.created = [];
    state.editionUpdates = [];
  });

  it("deletes the file it replaced, on disk and in the database", async () => {
    const incoming = join(downloads, "release.epub");
    await writeFile(incoming, "new epub");

    const result = await postProcessBook({
      editionId: 1,
      contentPath: incoming,
      releaseTitle: "Some.Release.epub",
      fileOperation: "move",
      isUpgrade: true,
    });

    expect(result.imported).toBe(1);
    expect(state.deletedIds).toEqual([1]);
    expect(await exists(oldPath)).toBe(false);
    // The imported file is still there.
    expect(state.files.map((f) => f.filePath)).toEqual(state.created);
    expect(await exists(state.created[0]!)).toBe(true);
  });

  // A normal grab adds to the edition; only an upgrade replaces.
  it("leaves existing files alone when the grab is not an upgrade", async () => {
    const incoming = join(downloads, "release.epub");
    await writeFile(incoming, "new epub");

    await postProcessBook({
      editionId: 1,
      contentPath: incoming,
      releaseTitle: "Some.Release.epub",
      fileOperation: "move",
    });

    expect(state.deletedIds).toEqual([]);
    expect(await exists(oldPath)).toBe(true);
  });

  // A row whose file is already gone still has to be cleaned up, or the edition
  // keeps reporting a file nothing can find.
  it("drops the row when the superseded file is already missing", async () => {
    await rm(oldPath);
    const incoming = join(downloads, "release.epub");
    await writeFile(incoming, "new epub");

    await postProcessBook({
      editionId: 1,
      contentPath: incoming,
      releaseTitle: "Some.Release.epub",
      fileOperation: "move",
      isUpgrade: true,
    });

    expect(state.deletedIds).toEqual([1]);
  });

  // Re-importing the same path must not delete the file it just wrote.
  it("does not delete a file it imported in this run", async () => {
    const incoming = join(downloads, "release.epub");
    await writeFile(incoming, "new epub");

    await postProcessBook({
      editionId: 1,
      contentPath: incoming,
      releaseTitle: "Some.Release.epub",
      fileOperation: "move",
      isUpgrade: true,
    });

    const importedPath = state.created[0]!;
    expect(state.deletedIds).not.toContain(
      state.files.find((f) => f.filePath === importedPath)?.id,
    );
    expect(await exists(importedPath)).toBe(true);
  });
});
