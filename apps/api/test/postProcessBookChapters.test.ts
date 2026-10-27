import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbModule } from "./mocks/prisma";

// Registering the chapter timeline is what makes an audiobook offline-ready.
// If the download import skips it, every manifest request 400s until someone
// rescans the edition by hand.

const root = await mkdtemp(join(tmpdir(), "rawkoon-book-chapters-"));
const downloads = join(root, "downloads");
const audiobooksRoot = join(root, "Audiobooks");
const booksRoot = join(root, "Books");

const state: { kind: string; registered: number[]; renamed: number[] } = {
  kind: "audiobook",
  registered: [],
  renamed: [],
};

mock.module("@rawkoon/api/db", () =>
  dbModule({
    prisma: {
      bookEdition: {
        findUnique: () =>
          Promise.resolve({
            id: 7,
            bookId: 3,
            kind: state.kind,
            book: {
              title: "A Quiet Harbour",
              authors: ["Camille Rousseau"],
              language: "fr",
              publishedYear: 2019,
            },
            bookQualityProfile: { allowedFormats: ["mp3", "m4b", "epub"] },
          }),
        update: () => Promise.resolve({ bookId: 3 }),
      },
      mediaSettings: {
        upsert: () =>
          Promise.resolve({
            booksLibraryPath: booksRoot,
            audiobooksLibraryPath: audiobooksRoot,
            bookTemplate: "{author}/{title} ({year})/{title} ({year})",
            audiobookTemplate: "{author}/{title} ({year})/{title}",
          }),
      },
      bookFile: {
        findMany: () => Promise.resolve([]),
        deleteMany: () => Promise.resolve({ count: 0 }),
        create: (args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 1, ...args.data }),
      },
    },
  }),
);

const realRegister = await import(
  "@rawkoon/api/services/books/registerBookChapters"
);
// Pass-through once this file is done, so later suites see the real module.
let intercept = true;
mock.module("@rawkoon/api/services/books/registerBookChapters", () => ({
  ...realRegister,
  registerBookChapters: (editionId: number) => {
    if (!intercept) return realRegister.registerBookChapters(editionId);
    state.registered.push(editionId);
    return Promise.resolve({
      chapters: 1,
      totalDurationSecs: 60,
      offlineReady: true,
    });
  },
}));

const realRename = await import(
  "@rawkoon/api/services/books/renameChaptersFromEbook"
);
mock.module("@rawkoon/api/services/books/renameChaptersFromEbook", () => ({
  ...realRename,
  renameAudiobookChaptersFromEbook: (bookId: number) => {
    if (!intercept) return realRename.renameAudiobookChaptersFromEbook(bookId);
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

const { postProcessBook } = await import(
  "@rawkoon/api/services/postProcessor/postProcessorBookImport"
);

afterAll(async () => {
  intercept = false;
  await rm(root, { recursive: true, force: true });
});

describe("postProcessBook chapter registration", () => {
  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(downloads, { recursive: true });
    state.registered = [];
    state.renamed = [];
  });

  it("registers the chapter timeline after importing an audiobook", async () => {
    state.kind = "audiobook";
    const release = join(downloads, "release");
    await mkdir(release, { recursive: true });
    await writeFile(join(release, "01 - Chapter 1.mp3"), "audio");
    await writeFile(join(release, "02 - Chapter 2.mp3"), "audio");

    const result = await postProcessBook({
      editionId: 7,
      contentPath: release,
      releaseTitle: "Some.Release.MP3",
      fileOperation: "move",
    });

    expect(result.imported).toBe(2);
    expect(state.registered).toEqual([7]);
    // An epub imported earlier can name this audiobook's placeholder chapters.
    expect(state.renamed).toEqual([3]);
  });

  it("does not register chapters for an ebook", async () => {
    state.kind = "ebook";
    const incoming = join(downloads, "release.epub");
    await writeFile(incoming, "epub");

    const result = await postProcessBook({
      editionId: 7,
      contentPath: incoming,
      releaseTitle: "Some.Release.epub",
      fileOperation: "move",
    });

    expect(result.imported).toBe(1);
    expect(state.registered).toEqual([]);
    // The epub can now name an audiobook imported before it.
    expect(state.renamed).toEqual([3]);
  });
});
