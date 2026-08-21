import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// rescanBookEdition adopts files already sitting in the library. It walks real
// directories, so these tests use a real tmpdir and mock only the database and
// the two metadata readers (which shell out to external binaries).

const root = await mkdtemp(join(tmpdir(), "rawkoon-rescan-"));
const booksRoot = join(root, "Books");
const audiobooksRoot = join(root, "Audiobooks");

type Row = { id: number; editionId: number; filePath: string };

const state: {
  edition: Record<string, unknown> | null;
  files: Row[];
  nextFileId: number;
  editionUpdates: Array<{
    where: { id: number };
    data: Record<string, unknown>;
  }>;
  deletedIds: number[];
  created: Array<Record<string, unknown>>;
} = {
  edition: null,
  files: [],
  nextFileId: 1,
  editionUpdates: [],
  deletedIds: [],
  created: [],
};

const editionFixture = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookEdition: {
      findUnique: () => Promise.resolve(state.edition),
      update: (args: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        state.editionUpdates.push(args);
        return Promise.resolve({ bookId: 9 });
      },
    },
    mediaSettings: {
      upsert: () =>
        Promise.resolve({
          booksLibraryPath: booksRoot,
          audiobooksLibraryPath: audiobooksRoot,
          bookTemplate: "{author}/{title} ({year})/{title} ({year}) [{format}]",
          audiobookTemplate: "{author}/{title} ({year})/{title}",
        }),
    },
    bookFile: {
      findMany: () => Promise.resolve(state.files),
      delete: (args: { where: { id: number } }) => {
        state.deletedIds.push(args.where.id);
        state.files = state.files.filter((f) => f.id !== args.where.id);
        return Promise.resolve({});
      },
      deleteMany: (args: { where: { filePath: string } }) => {
        const before = state.files.length;
        state.files = state.files.filter(
          (f) => f.filePath !== args.where.filePath,
        );
        return Promise.resolve({ count: before - state.files.length });
      },
      create: (args: { data: Record<string, unknown> }) => {
        state.created.push(args.data);
        const row = {
          id: state.nextFileId++,
          editionId: args.data.editionId as number,
          filePath: args.data.filePath as string,
        };
        state.files.push(row);
        return Promise.resolve(row);
      },
      update: () => Promise.resolve({}),
    },
    // An audiobook import probes for chapter marks; this stub only has to make
    // the transaction resolve, since the chapter parser has its own tests.
    bookFileChapter: {
      deleteMany: () => Promise.resolve({ count: 0 }),
      createMany: () => Promise.resolve({ count: 0 }),
    },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  },
}));

const realMediainfo = await import(
  "@rawkoon/api/utils/medias/mediainfoScanner"
);
mock.module("@rawkoon/api/utils/medias/mediainfoScanner", () => ({
  ...realMediainfo,
  scanMediaInfo: () =>
    Promise.resolve({
      durationSecs: 3600,
      audioTracks: [{ bitrate_kbps: 64, codec: "aac", language: "fr" }],
    }),
}));

const realEbookMetadata = await import(
  "@rawkoon/api/utils/books/ebookMetadata"
);
mock.module("@rawkoon/api/utils/books/ebookMetadata", () => ({
  ...realEbookMetadata,
  readEbookMetadata: () => Promise.resolve({ language: "fr" }),
}));

const { rescanBookEdition } = await import(
  "@rawkoon/api/services/postProcessorBook"
);

// Where the default templates put this fixture's files.
const ebookDir = join(booksRoot, "Camille Rousseau", "A Quiet Harbour (2019)");
const audiobookDir = join(
  audiobooksRoot,
  "Camille Rousseau",
  "A Quiet Harbour (2019)",
  "A Quiet Harbour",
);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("rescanBookEdition", () => {
  beforeEach(async () => {
    await rm(booksRoot, { recursive: true, force: true });
    await rm(audiobooksRoot, { recursive: true, force: true });
    state.edition = editionFixture();
    state.files = [];
    state.nextFileId = 1;
    state.editionUpdates = [];
    state.deletedIds = [];
    state.created = [];
  });

  // The scenario this function exists for: a book was removed (which keeps its
  // files) and re-added, leaving an edition with no rows and a file on disk.
  it("registers a file already in the library and marks the edition downloaded", async () => {
    await mkdir(ebookDir, { recursive: true });
    const file = join(ebookDir, "A Quiet Harbour (2019) [epub].epub");
    await writeFile(file, "x");

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(1);
    expect(result.refreshed).toBe(0);
    expect(result.directory).toBe(ebookDir);
    expect(state.created[0]?.filePath).toBe(file);
    expect(state.created[0]?.format).toBe("epub");
    expect(state.editionUpdates.at(-1)?.data.status).toBe("downloaded");
  });

  // Repeat scans used to report registered: 1 forever, because rows are
  // replaced by path. Nothing new was adopted, and the count must say so.
  it("reports a repeat scan as refreshed, not registered", async () => {
    await mkdir(ebookDir, { recursive: true });
    await writeFile(join(ebookDir, "A Quiet Harbour (2019) [epub].epub"), "x");

    await rescanBookEdition(1);
    const second = await rescanBookEdition(1);

    expect(second.registered).toBe(0);
    expect(second.refreshed).toBe(1);
    expect(state.files).toHaveLength(1);
  });

  it("drops rows whose file has disappeared and reverts the edition to wanted", async () => {
    state.files = [
      { id: 5, editionId: 1, filePath: join(ebookDir, "gone.epub") },
    ];

    const result = await rescanBookEdition(1);

    expect(result.removed).toBe(1);
    expect(state.deletedIds).toEqual([5]);
    expect(result.registered).toBe(0);
    expect(state.editionUpdates.at(-1)?.data.status).toBe("wanted");
  });

  // Only the templated directory is walked, so an unrelated book next door in
  // the library can never be adopted onto this edition.
  it("ignores files outside the edition's own directory", async () => {
    await mkdir(join(booksRoot, "Other Author", "Other Title (2020)"), {
      recursive: true,
    });
    await writeFile(
      join(booksRoot, "Other Author", "Other Title (2020)", "other.epub"),
      "x",
    );

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(0);
    expect(result.directory).toBeNull();
    expect(state.created).toEqual([]);
  });

  it("skips cover art and other junk that ships beside the book", async () => {
    await mkdir(ebookDir, { recursive: true });
    await writeFile(join(ebookDir, "A Quiet Harbour (2019) [epub].epub"), "x");
    await writeFile(join(ebookDir, "cover.jpg"), "x");
    await writeFile(join(ebookDir, "info.nfo"), "x");

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(1);
    expect(state.created).toHaveLength(1);
  });

  // Audio files under an ebook edition are somebody else's — a teaser track, a
  // bundled sample — and must not become rows on it.
  it("ignores audio files under an ebook edition", async () => {
    await mkdir(ebookDir, { recursive: true });
    await writeFile(join(ebookDir, "teaser.mp3"), "x");

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(0);
    expect(state.created).toEqual([]);
  });

  it("registers every track of an audiobook edition and reads its media info", async () => {
    state.edition = editionFixture({
      kind: "audiobook",
      bookQualityProfile: { allowedFormats: ["m4b", "mp3"] },
    });
    await mkdir(audiobookDir, { recursive: true });
    for (const name of ["01.mp3", "02.mp3", "03.mp3"]) {
      await writeFile(join(audiobookDir, name), "x");
    }

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(3);
    expect(result.directory).toBe(audiobookDir);
    expect(state.created[0]?.durationSecs).toBe(3600);
    expect(state.created[0]?.audioBitrate).toBe(64);
    // Tracks keep their own filenames.
    expect(state.created.map((c) => c.fileName).sort()).toEqual([
      "01.mp3",
      "02.mp3",
      "03.mp3",
    ]);
  });

  it("reports an error instead of guessing when no library path is set", async () => {
    const realDb = await import("@rawkoon/api/db");
    const settings = realDb.prisma.mediaSettings as unknown as {
      upsert: () => Promise<unknown>;
    };
    const original = settings.upsert;
    settings.upsert = () =>
      Promise.resolve({
        booksLibraryPath: null,
        audiobooksLibraryPath: audiobooksRoot,
        bookTemplate: "{author}/{title}",
        audiobookTemplate: "{author}/{title}",
      });

    const result = await rescanBookEdition(1);
    settings.upsert = original;

    expect(result.error).toBe("No ebook library path configured");
    expect(result.registered).toBe(0);
  });

  it("reports an error when the edition does not exist", async () => {
    state.edition = null;

    const result = await rescanBookEdition(1);

    expect(result.error).toBe("Edition not found");
  });
});
