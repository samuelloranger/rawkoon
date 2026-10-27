import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type Chapter = {
  id: number;
  title: string;
  startSecs: number;
  endSecs: number;
};

let audiobook: { id: number; chapters: Chapter[] } | null = null;
const findUnique = mock(async () => audiobook);
const updateChapter = mock((args: unknown) => args);
const transaction = mock(async (ops: unknown[]) => ops);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookEdition: { findUnique },
    bookChapter: { update: updateChapter },
    $transaction: transaction,
  },
}));

let ebookNames: string[] | null = null;
const ebookChapterNames = mock(async () => ebookNames);
mock.module("@rawkoon/api/services/books/ebookChapterNames", () => ({
  ebookChapterNames,
}));

const { hasPlaceholderTitles, renameAudiobookChaptersFromEbook } = await import(
  "./renameChaptersFromEbook"
);

const chapters = (titles: string[]): Chapter[] =>
  titles.map((title, i) => ({
    id: 100 + i,
    title,
    startSecs: i * 100,
    endSecs: (i + 1) * 100 + i * 10,
  }));

afterAll(() => mock.restore());

describe("hasPlaceholderTitles", () => {
  test("flags identical titles and the numbered fallback", () => {
    expect(hasPlaceholderTitles(["Book", "Book", "Book"])).toBe(true);
    expect(hasPlaceholderTitles(["Chapter 1", "Chapter 2", "Chapter 3"])).toBe(
      true,
    );
  });

  test("leaves real or partly real titles alone", () => {
    expect(hasPlaceholderTitles(["Prologue", "Chapter 2", "Chapter 3"])).toBe(
      false,
    );
    expect(hasPlaceholderTitles(["Chapter 2", "Chapter 3", "Chapter 4"])).toBe(
      false,
    );
    expect(hasPlaceholderTitles(["Book"])).toBe(false);
  });
});

describe("renameAudiobookChaptersFromEbook", () => {
  beforeEach(() => {
    findUnique.mockClear();
    updateChapter.mockClear();
    transaction.mockClear();
    ebookChapterNames.mockClear();
  });

  test("renames placeholder chapters from the epub, keeping offsets", async () => {
    audiobook = { id: 9, chapters: chapters(["Book", "Book", "Book", "Book"]) };
    ebookNames = ["Chapitre 1", "Chapitre 2", "Chapitre 3", "Épilogue"];

    expect(await renameAudiobookChaptersFromEbook(5)).toBe(true);
    expect(ebookChapterNames).toHaveBeenCalledWith(9, [100, 110, 120, 130]);
    expect(updateChapter.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 100 }, data: { title: "Chapitre 1" } },
      { where: { id: 101 }, data: { title: "Chapitre 2" } },
      { where: { id: 102 }, data: { title: "Chapitre 3" } },
      { where: { id: 103 }, data: { title: "Épilogue" } },
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  test("leaves chapters that already have real names", async () => {
    audiobook = {
      id: 9,
      chapters: chapters(["Prologue", "One", "Two", "End"]),
    };
    expect(await renameAudiobookChaptersFromEbook(5)).toBe(false);
    expect(ebookChapterNames).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  test("changes nothing when the epub can't name them", async () => {
    audiobook = { id: 9, chapters: chapters(["Book", "Book", "Book", "Book"]) };
    ebookNames = null;
    expect(await renameAudiobookChaptersFromEbook(5)).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  test("does nothing for a book without an audiobook", async () => {
    audiobook = null;
    expect(await renameAudiobookChaptersFromEbook(5)).toBe(false);
    expect(ebookChapterNames).not.toHaveBeenCalled();
  });
});
