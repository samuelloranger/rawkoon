import { mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbModule } from "./prisma";

// rescanBookEdition adopts files already sitting in the library. It walks real
// directories, so these tests use a real tmpdir and mock only the database and
// the two metadata readers (which shell out to external binaries).

export type Row = {
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

/** Fresh tmpdir, state and module mocks; each test file calls it once. */
export async function setupRescanBookHarness() {
  const root = await mkdtemp(join(tmpdir(), "rawkoon-rescan-"));
  const booksRoot = join(root, "Books");
  const audiobooksRoot = join(root, "Audiobooks");

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
    fileUpdates: Array<Record<string, unknown>>;
    renamed: number[];
  } = {
    edition: null,
    files: [],
    nextFileId: 1,
    chapterDeleteCalls: 0,
    chaptersCreated: [],
    editionUpdates: [],
    deletedIds: [],
    created: [],
    fileUpdates: [],
    renamed: [],
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

  mock.module("@rawkoon/api/db", () =>
    dbModule({
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
              bookTemplate:
                "{author}/{title} ({year})/{title} ({year}) [{format}]",
              audiobookTemplate: "{author}/{title} ({year})/{title}",
            }),
        },
        bookFile: {
          findMany: () => Promise.resolve(state.files),
          findFirst: (args: { where: { filePath: string } }) =>
            Promise.resolve(
              state.files.find((f) => f.filePath === args.where.filePath) ??
                null,
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
          update: (args: { data: Record<string, unknown> }) => {
            state.fileUpdates.push(args.data);
            return Promise.resolve({});
          },
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
    }),
  );

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

  const realRename = await import(
    "@rawkoon/api/services/books/renameChaptersFromEbook"
  );
  mock.module("@rawkoon/api/services/books/renameChaptersFromEbook", () => ({
    ...realRename,
    renameAudiobookChaptersFromEbook: (bookId: number) => {
      state.renamed.push(bookId);
      return Promise.resolve(false);
    },
  }));

  const realEbookMetadata = await import(
    "@rawkoon/api/utils/books/ebookMetadata"
  );
  mock.module("@rawkoon/api/utils/books/ebookMetadata", () => ({
    ...realEbookMetadata,
    readEbookMetadata: () => Promise.resolve({ language: "fr" }),
  }));

  const { rescanBookEdition } = await import(
    "@rawkoon/api/services/postProcessor/postProcessorBook"
  );

  // Where the default templates put this fixture's files.
  const ebookDir = join(
    booksRoot,
    "Camille Rousseau",
    "A Quiet Harbour (2019)",
  );
  const audiobookDir = join(
    audiobooksRoot,
    "Camille Rousseau",
    "A Quiet Harbour (2019)",
    "A Quiet Harbour",
  );

  const resetState = async () => {
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
    state.fileUpdates = [];
    state.renamed = [];
  };
  const cleanup = () => rm(root, { recursive: true, force: true });

  return {
    state,
    editionFixture,
    rescanBookEdition,
    ebookDir,
    audiobookDir,
    booksRoot,
    audiobooksRoot,
    resetState,
    cleanup,
  };
}
