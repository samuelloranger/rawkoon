import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const files = [1, 2, 3].map((n) => ({
  id: n,
  filePath: `/library/Book/0${n} Same Title.mp3`,
  fileName: `0${n} Same Title.mp3`,
}));
const durations = new Map(files.map((f, i) => [f.filePath, (i + 1) * 100]));

const spawn = mock((argv: string[]) => {
  const out = argv.includes("-show_chapters")
    ? JSON.stringify({ chapters: [] })
    : `${durations.get(argv.at(-1) ?? "") ?? ""}`;
  return {
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(out));
        controller.close();
      },
    }),
    exited: Promise.resolve(0),
  } as unknown as Bun.Subprocess;
});
const originalSpawn = Bun.spawn;

const createChapter = mock(async () => ({}));
const tx = {
  bookChapter: { deleteMany: mock(async () => ({})), create: createChapter },
  bookFile: { update: mock(async () => ({})) },
  bookEdition: { update: mock(async () => ({})) },
};
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookFile: { findMany: mock(async () => files) },
    $transaction: mock(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  },
}));

let ebookNames: string[] | null = null;
const ebookChapterNames = mock(async () => ebookNames);
mock.module("@rawkoon/api/services/books/ebookChapterNames", () => ({
  ebookChapterNames,
}));

const { registerBookChapters } = await import("./registerBookChapters");

const titles = () =>
  createChapter.mock.calls.map(
    (call) => (call as unknown as [{ data: { title: string } }])[0].data.title,
  );

afterAll(() => {
  (Bun as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
  mock.restore();
});

describe("registerBookChapters with files all named after the book", () => {
  beforeEach(() => {
    (Bun as { spawn: typeof Bun.spawn }).spawn =
      spawn as unknown as typeof Bun.spawn;
    createChapter.mockClear();
    ebookChapterNames.mockClear();
  });

  test("names chapters from the ebook when it matches", async () => {
    ebookNames = ["Chapitre 1", "Chapitre 2", "Épilogue"];
    await registerBookChapters(7);
    expect(ebookChapterNames).toHaveBeenCalledWith(7, [100, 200, 300]);
    expect(titles()).toEqual(["Chapitre 1", "Chapitre 2", "Épilogue"]);
  });

  test("numbers chapters when the ebook can't name them", async () => {
    ebookNames = null;
    await registerBookChapters(7);
    expect(titles()).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
  });
});
