import { describe, expect, mock, test } from "bun:test";

// The module imports prisma at load; these tests only touch its pure helpers.
mock.module("@rawkoon/api/db", () => ({ prisma: {} }));

const { chapterTitleFromFileName, titlesAreUninformative, sortChapterFiles } =
  await import("./registerBookChapters");

describe("chapterTitleFromFileName", () => {
  test("strips the ordinal prefix and the extension", () => {
    expect(chapterTitleFromFileName("01 - Chapter 1.mp3")).toBe("Chapter 1");
    expect(chapterTitleFromFileName("61 - Chapter 61.mp3")).toBe("Chapter 61");
  });

  test("falls back to the stem when there is no ordinal prefix", () => {
    expect(chapterTitleFromFileName("Prologue.mp3")).toBe("Prologue");
  });

  // The real library names them this way — no dash at all.
  test("handles a space or a dot as the separator", () => {
    expect(chapterTitleFromFileName("62 Epilogue.mp3")).toBe("Epilogue");
    expect(chapterTitleFromFileName("31 Chapitre 31.mp3")).toBe("Chapitre 31");
    expect(chapterTitleFromFileName("07. Chapter 7.mp3")).toBe("Chapter 7");
  });

  // Digits that are part of the title, not an ordinal: no separator follows.
  test("does not eat a leading number that is the title", () => {
    expect(chapterTitleFromFileName("1984.mp3")).toBe("1984");
  });
});

describe("sortChapterFiles", () => {
  /**
   * Lexicographic order puts "10" before "2". The reference book has 61
   * chapters, so this is not hypothetical — it would interleave the whole
   * second half of the book and corrupt every offset.
   */
  test("orders numerically, not lexicographically", () => {
    const sorted = sortChapterFiles([
      "10 - Chapter 10.mp3",
      "2 - Chapter 2.mp3",
      "1 - Chapter 1.mp3",
    ]);
    expect(sorted).toEqual([
      "1 - Chapter 1.mp3",
      "2 - Chapter 2.mp3",
      "10 - Chapter 10.mp3",
    ]);
  });

  test("keeps zero-padded names in order too", () => {
    expect(sortChapterFiles(["02 - B.mp3", "01 - A.mp3"])).toEqual([
      "01 - A.mp3",
      "02 - B.mp3",
    ]);
  });

  /**
   * "62 Epilogue.mp3" — the naming the audiobooks in the library actually use.
   * A dash-only ordinal matched none of these, so ordering fell back to
   * localeCompare: fine while every name is zero-padded, wrong the moment one
   * is not, and every offset after the misplaced chapter is then wrong too.
   */
  test("orders numerically when the separator is only a space", () => {
    expect(
      sortChapterFiles([
        "10 Chapitre 10.mp3",
        "2 Chapitre 2.mp3",
        "62 Epilogue.mp3",
        "1 Chapitre 1.mp3",
      ]),
    ).toEqual([
      "1 Chapitre 1.mp3",
      "2 Chapitre 2.mp3",
      "10 Chapitre 10.mp3",
      "62 Epilogue.mp3",
    ]);
  });
});

describe("titlesAreUninformative", () => {
  test("flags files that are all named after the book", () => {
    expect(
      titlesAreUninformative(["Book Title", "Book Title", "Book Title"]),
    ).toBe(true);
  });

  test("keeps titles that tell the chapters apart, even with some repeats", () => {
    expect(
      titlesAreUninformative([
        "Prologue",
        "Chapter 1",
        "Chapter 1",
        "Epilogue",
      ]),
    ).toBe(false);
  });

  test("a lone chapter's title is kept", () => {
    expect(titlesAreUninformative(["Book Title"])).toBe(false);
  });
});
