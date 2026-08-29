import { beforeEach, describe, expect, mock, test } from "bun:test";

const findMany = mock(async () => [
  {
    id: 1,
    filePath: "/library/Book/01 - Chapter 1.mp3",
    fileName: "01 - Chapter 1.mp3",
  },
]);
const updateEdition = mock(async () => ({}));
const deleteChapters = mock(async () => ({ count: 0 }));
const createChapter = mock(async () => ({}));
const updateBookFile = mock(async () => ({}));
const transaction = mock(
  async (
    fn: (tx: {
      bookChapter: {
        deleteMany: typeof deleteChapters;
        create: typeof createChapter;
      };
      bookFile: { update: typeof updateBookFile };
      bookEdition: { update: typeof updateEdition };
    }) => Promise<void>,
  ) =>
    await fn({
      bookChapter: { deleteMany: deleteChapters, create: createChapter },
      bookFile: { update: updateBookFile },
      bookEdition: { update: updateEdition },
    }),
);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookFile: { findMany },
    bookEdition: { update: updateEdition },
    $transaction: transaction,
  },
}));

const { chapterTitleFromFileName, registerBookChapters, sortChapterFiles } =
  await import("./registerBookChapters");

describe("chapterTitleFromFileName", () => {
  test("strips the ordinal prefix and the extension", () => {
    expect(chapterTitleFromFileName("01 - Chapter 1.mp3")).toBe("Chapter 1");
    expect(chapterTitleFromFileName("61 - Chapter 61.mp3")).toBe("Chapter 61");
  });

  test("falls back to the stem when there is no ordinal prefix", () => {
    expect(chapterTitleFromFileName("Prologue.mp3")).toBe("Prologue");
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
});

describe("registerBookChapters", () => {
  beforeEach(() => {
    findMany.mockClear();
    updateEdition.mockClear();
    deleteChapters.mockClear();
    createChapter.mockClear();
    updateBookFile.mockClear();
    transaction.mockClear();
  });

  test("refuses an edition with fewer than two audio files", async () => {
    const result = await registerBookChapters(61);

    expect(result).toEqual({
      chapters: 0,
      totalDurationSecs: 0,
      offlineReady: false,
      reason: "Edition is not split into chapters",
    });
    expect(updateEdition).toHaveBeenCalledWith({
      where: { id: 61 },
      data: { offlineReady: false },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(deleteChapters).not.toHaveBeenCalled();
    expect(createChapter).not.toHaveBeenCalled();
    expect(updateBookFile).not.toHaveBeenCalled();
  });
});
