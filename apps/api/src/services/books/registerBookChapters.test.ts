import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type MockBookFile = { id: number; filePath: string; fileName: string };
type CreatedChapterData = {
  editionId: number;
  bookFileId: number;
  index: number;
  title: string;
  startSecs: number;
  endSecs: number;
};

let findManyResult: MockBookFile[] = [
  {
    id: 1,
    filePath: "/library/Book/01 - Chapter 1.mp3",
    fileName: "01 - Chapter 1.mp3",
  },
];
const findMany = mock(async () => findManyResult);
let probeResults = new Map<string, number | null>([
  ["/library/Book/01 - Chapter 1.mp3", 60],
]);
const spawn = mock((argv: string[]) => {
  const filePath = argv.at(-1);
  const duration =
    typeof filePath === "string" ? (probeResults.get(filePath) ?? null) : null;
  const out = duration === null ? "" : `${duration}`;
  return {
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(out));
        controller.close();
      },
    }),
    exited: Promise.resolve(duration === null ? 1 : 0),
  } as Bun.Subprocess;
});
const originalSpawn = Bun.spawn;
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

const chapterCreateCalls = () =>
  createChapter.mock.calls.map((call) => {
    const arg = call.at(0);
    if (!arg || typeof arg !== "object" || !("data" in arg)) {
      throw new Error("bookChapter.create called without data");
    }
    return arg as { data: CreatedChapterData };
  });

afterAll(() => {
  (Bun as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
  mock.restore();
});

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
    (Bun as { spawn: typeof Bun.spawn }).spawn =
      spawn as unknown as typeof Bun.spawn;

    findManyResult = [
      {
        id: 1,
        filePath: "/library/Book/01 - Chapter 1.mp3",
        fileName: "01 - Chapter 1.mp3",
      },
    ];
    probeResults = new Map([["/library/Book/01 - Chapter 1.mp3", 60]]);

    findMany.mockClear();
    spawn.mockClear();
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
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteChapters).toHaveBeenCalledWith({ where: { editionId: 61 } });
    expect(createChapter).not.toHaveBeenCalled();
    expect(updateBookFile).not.toHaveBeenCalled();
  });

  test("creates a contiguous chapter timeline tied to the right files", async () => {
    findManyResult = [
      {
        id: 22,
        filePath: "/library/Book/02 - Chapter 2.mp3",
        fileName: "02 - Chapter 2.mp3",
      },
      {
        id: 11,
        filePath: "/library/Book/01 - Chapter 1.mp3",
        fileName: "01 - Chapter 1.mp3",
      },
      {
        id: 33,
        filePath: "/library/Book/03 - Chapter 3.mp3",
        fileName: "03 - Chapter 3.mp3",
      },
    ];
    probeResults = new Map([
      ["/library/Book/01 - Chapter 1.mp3", 120],
      ["/library/Book/02 - Chapter 2.mp3", 90],
      ["/library/Book/03 - Chapter 3.mp3", 30],
    ]);

    const result = await registerBookChapters(61);

    expect(result).toEqual({
      chapters: 3,
      totalDurationSecs: 240,
      offlineReady: true,
    });

    const created = chapterCreateCalls().map((arg) => arg.data);
    expect(created).toEqual([
      {
        editionId: 61,
        bookFileId: 11,
        index: 0,
        title: "Chapter 1",
        startSecs: 0,
        endSecs: 120,
      },
      {
        editionId: 61,
        bookFileId: 22,
        index: 1,
        title: "Chapter 2",
        startSecs: 120,
        endSecs: 210,
      },
      {
        editionId: 61,
        bookFileId: 33,
        index: 2,
        title: "Chapter 3",
        startSecs: 210,
        endSecs: 240,
      },
    ]);
    expect(created[1]?.startSecs).toBe(created[0]?.endSecs);
    expect(created[2]?.startSecs).toBe(created[1]?.endSecs);
    expect(new Set(created.map((chapter) => chapter.bookFileId)).size).toBe(3);
  });

  test("registers duplicate basenames against distinct BookFile ids", async () => {
    findManyResult = [
      {
        id: 101,
        filePath: "/library/Book/Disc 1/01 - Chapter 1.mp3",
        fileName: "01 - Chapter 1.mp3",
      },
      {
        id: 202,
        filePath: "/library/Book/Disc 2/01 - Chapter 1.mp3",
        fileName: "01 - Chapter 1.mp3",
      },
      {
        id: 303,
        filePath: "/library/Book/Disc 2/02 - Chapter 2.mp3",
        fileName: "02 - Chapter 2.mp3",
      },
    ];
    probeResults = new Map([
      ["/library/Book/Disc 1/01 - Chapter 1.mp3", 50],
      ["/library/Book/Disc 2/01 - Chapter 1.mp3", 55],
      ["/library/Book/Disc 2/02 - Chapter 2.mp3", 60],
    ]);

    await registerBookChapters(88);

    const bookFileIds = chapterCreateCalls().map((arg) => arg.data.bookFileId);
    expect(bookFileIds).toContain(101);
    expect(bookFileIds).toContain(202);
    expect(bookFileIds).toContain(303);
    expect(new Set(bookFileIds).size).toBe(bookFileIds.length);
  });

  test("deletes stale chapters when probing fails", async () => {
    findManyResult = [
      {
        id: 11,
        filePath: "/library/Book/01 - Chapter 1.mp3",
        fileName: "01 - Chapter 1.mp3",
      },
      {
        id: 12,
        filePath: "/library/Book/02 - Chapter 2.mp3",
        fileName: "02 - Chapter 2.mp3",
      },
    ];
    probeResults = new Map([
      ["/library/Book/01 - Chapter 1.mp3", 100],
      ["/library/Book/02 - Chapter 2.mp3", null],
    ]);

    const result = await registerBookChapters(72);

    expect(result).toEqual({
      chapters: 0,
      totalDurationSecs: 0,
      offlineReady: false,
      reason: "Could not probe 02 - Chapter 2.mp3",
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteChapters).toHaveBeenCalledWith({ where: { editionId: 72 } });
    expect(updateEdition).toHaveBeenCalledWith({
      where: { id: 72 },
      data: { offlineReady: false },
    });
    expect(createChapter).not.toHaveBeenCalled();
    expect(updateBookFile).not.toHaveBeenCalled();
  });
});
