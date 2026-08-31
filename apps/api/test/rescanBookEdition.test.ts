import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// rescanBookEdition adopts files already sitting in the library. It walks real
// directories, so these tests use a real tmpdir and mock only the database and
// the two metadata readers (which shell out to external binaries).

const root = await mkdtemp(join(tmpdir(), "rawkoon-rescan-"));
const booksRoot = join(root, "Books");
const audiobooksRoot = join(root, "Audiobooks");

type Row = {
  id: number;
  editionId: number;
  filePath: string;
  fileName: string;
  // The identity fields a real row carries. Without them on a created row, a
  // second scan cannot recognise the file as unchanged and re-probes it.
  sizeBytes?: bigint;
  fileDev?: string | null;
  fileIno?: string | null;
  fileMtimeMs?: bigint | null;
};

const state: {
  edition: Record<string, unknown> | null;
  files: Row[];
  nextFileId: number;
  chapterDeleteCalls: number;
  chaptersCreated: Array<Record<string, unknown>>;
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
  chapterDeleteCalls: 0,
  chaptersCreated: [],
  editionUpdates: [],
  deletedIds: [],
  created: [],
};

const pushEditionUpdate = (args: {
  where: { id: number };
  data: Record<string, unknown>;
}) => {
  state.editionUpdates.push(args);
  return Promise.resolve({ bookId: 9 });
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
      update: pushEditionUpdate,
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
      findFirst: (args: { where: { filePath: string } }) =>
        Promise.resolve(
          state.files.find((f) => f.filePath === args.where.filePath) ?? null,
        ),
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
        const row: Row = {
          id: state.nextFileId++,
          editionId: args.data.editionId as number,
          filePath: args.data.filePath as string,
          fileName: args.data.fileName as string,
          sizeBytes: args.data.sizeBytes as bigint,
          fileDev: args.data.fileDev as string | null,
          fileIno: args.data.fileIno as string | null,
          fileMtimeMs: args.data.fileMtimeMs as bigint | null,
        };
        state.files.push(row);
        return Promise.resolve(row);
      },
      update: () => Promise.resolve({}),
    },
    $transaction: async (
      arg:
        | Promise<unknown>[]
        | ((tx: {
            bookChapter: {
              deleteMany: (args: unknown) => Promise<unknown>;
              create: (args: {
                data: Record<string, unknown>;
              }) => Promise<unknown>;
            };
            bookFile: { update: (args: unknown) => Promise<unknown> };
            bookEdition: {
              update: (args: {
                where: { id: number };
                data: Record<string, unknown>;
              }) => Promise<unknown>;
            };
          }) => Promise<unknown>),
    ) => {
      if (typeof arg === "function") {
        return arg({
          bookChapter: {
            deleteMany: async () => {
              state.chapterDeleteCalls += 1;
              return { count: 0 };
            },
            create: async (args: { data: Record<string, unknown> }) => {
              state.chaptersCreated.push(args.data);
              return args.data;
            },
          },
          bookFile: { update: async () => ({}) },
          bookEdition: { update: pushEditionUpdate },
        });
      }
      return Promise.all(arg);
    },
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
    state.chapterDeleteCalls = 0;
    state.chaptersCreated = [];
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
    expect(state.editionUpdates.map((u) => u.data)).toContainEqual({
      status: "downloaded",
    });
    expect(state.editionUpdates.map((u) => u.data)).toContainEqual({
      offlineReady: false,
    });
    expect(state.chapterDeleteCalls).toBe(1);
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
    expect(state.chapterDeleteCalls).toBe(1);
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
    expect(state.editionUpdates.map((u) => u.data)).toContainEqual({
      offlineReady: false,
    });
    expect(state.chapterDeleteCalls).toBe(1);
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

  // An audiobook rescan now also registers the chapter timeline, which is what
  // flips `offlineReady`. That path probes each track through ffprobe, so it is
  // covered by the registerBookChapters suite rather than mocked here —
  // `mock.module` is process-wide in bun and would break that suite.
  /**
   * The directory was created at import time from the metadata of the day. A
   * later refresh bumped publishedYear, so re-rendering the template names a
   * directory that never existed — and the rescan used to answer "no files
   * found in the library for this edition" about a file sitting right there.
   */
  it("finds files through the rows' own directory when metadata drifted since import", async () => {
    // On disk under (2019); the book now says 2024.
    await mkdir(ebookDir, { recursive: true });
    const file = join(ebookDir, "A Quiet Harbour (2019) [epub].epub");
    await writeFile(file, "x");
    state.edition = editionFixture({
      book: { ...editionFixture().book, publishedYear: 2024 },
    });
    state.files = [
      { id: 7, editionId: 1, filePath: file, fileName: basename(file) } as Row,
    ];

    const result = await rescanBookEdition(1);

    expect(result.directory).toBe(ebookDir);
    expect(result.refreshed).toBe(1);
    expect(state.deletedIds).toEqual([]);
  });

  // Uppercase extensions are real: the library holds both ".epub" and ".EPUB".
  it("adopts a file whose extension is uppercased", async () => {
    await mkdir(ebookDir, { recursive: true });
    await writeFile(join(ebookDir, "A Quiet Harbour (2019) [epub].EPUB"), "x");

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(1);
    expect(state.created[0]?.format).toBe("epub");
  });

  /**
   * A chapter replaced or re-encoded in place keeps its row, so it is neither
   * registered nor removed — but its duration moved, and every cumulative
   * offset after it in the timeline is now wrong. Leaving offlineReady true
   * would serve a manifest whose seeks land in the wrong place.
   */
  it("invalidates the chapter timeline when an existing file's bytes changed", async () => {
    const { stat } = await import("node:fs/promises");
    state.edition = editionFixture({
      kind: "audiobook",
      offlineReady: true,
      bookQualityProfile: { allowedFormats: ["mp3"] },
    });
    await mkdir(audiobookDir, { recursive: true });
    const track = join(audiobookDir, "01.mp3");
    await writeFile(track, "x");
    const st = await stat(track);
    state.files = [
      {
        id: 42,
        editionId: 1,
        filePath: track,
        fileName: "01.mp3",
        // A size that disagrees with disk is the "changed in place" signal.
        sizeBytes: BigInt(st.size + 1024),
        fileDev: String(st.dev),
        fileIno: String(st.ino),
        fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
      } as unknown as Row,
    ];

    await rescanBookEdition(1);

    expect(state.chapterDeleteCalls).toBeGreaterThan(0);
    expect(
      state.editionUpdates.some((u) => u.data.offlineReady === false),
    ).toBe(true);
  });

  // The unchanged-file fast path must not drag the timeline down with it.
  it("leaves the chapter timeline alone when nothing changed", async () => {
    const { stat } = await import("node:fs/promises");
    state.edition = editionFixture({
      kind: "audiobook",
      offlineReady: true,
      bookQualityProfile: { allowedFormats: ["mp3"] },
    });
    await mkdir(audiobookDir, { recursive: true });
    const track = join(audiobookDir, "01.mp3");
    await writeFile(track, "x");
    const st = await stat(track);
    state.files = [
      {
        id: 42,
        editionId: 1,
        filePath: track,
        fileName: "01.mp3",
        sizeBytes: BigInt(st.size),
        fileDev: String(st.dev),
        fileIno: String(st.ino),
        fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
      } as unknown as Row,
    ];

    await rescanBookEdition(1);

    expect(state.chapterDeleteCalls).toBe(0);
  });

  // The expensive part of a rescan is the per-file probe. An unchanged file
  // keeps its row untouched rather than paying for it again.
  it("skips re-probing a file whose size, inode and mtime are unchanged", async () => {
    const { stat } = await import("node:fs/promises");
    state.edition = editionFixture({
      kind: "audiobook",
      offlineReady: true,
      bookQualityProfile: { allowedFormats: ["mp3"] },
    });
    await mkdir(audiobookDir, { recursive: true });
    const track = join(audiobookDir, "01.mp3");
    await writeFile(track, "x");
    const st = await stat(track);
    state.files = [
      {
        id: 42,
        editionId: 1,
        filePath: track,
        fileName: "01.mp3",
        sizeBytes: BigInt(st.size),
        fileDev: String(st.dev),
        fileIno: String(st.ino),
        fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
      } as unknown as Row,
    ];

    const result = await rescanBookEdition(1);

    expect(result.refreshed).toBe(1);
    expect(result.registered).toBe(0);
    // No upsert ran, so nothing was re-probed.
    expect(state.created).toEqual([]);
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
