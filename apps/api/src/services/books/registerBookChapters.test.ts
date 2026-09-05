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

type RawChapterAtom = {
  start_time: string;
  end_time: string;
  tags?: { title?: string };
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
// Per-path embedded chapter atoms for the `-show_chapters` probe.
//   [] or absent -> ffprobe succeeds with no chapters (probe returns null)
//   null         -> ffprobe exits non-zero (probe returns null)
let atomResults = new Map<string, RawChapterAtom[] | null>();

const makeProc = (out: string, code: number): Bun.Subprocess =>
  ({
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(out));
        controller.close();
      },
    }),
    exited: Promise.resolve(code),
  }) as Bun.Subprocess;

const spawn = mock((argv: string[]) => {
  const filePath = argv.at(-1);
  if (argv.includes("-show_chapters")) {
    const raw =
      typeof filePath === "string" ? atomResults.get(filePath) : undefined;
    if (raw === null) {
      return makeProc("", 1);
    }
    return makeProc(JSON.stringify({ chapters: raw ?? [] }), 0);
  }
  const duration =
    typeof filePath === "string" ? (probeResults.get(filePath) ?? null) : null;
  const out = duration === null ? "" : `${duration}`;
  return makeProc(out, duration === null ? 1 : 0);
});
const originalSpawn = Bun.spawn;
let editionBookTitle: string | null = null;
const findUniqueEdition = mock(async () =>
  editionBookTitle === null ? null : { book: { title: editionBookTitle } },
);
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
    bookEdition: { update: updateEdition, findUnique: findUniqueEdition },
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
    atomResults = new Map();
    editionBookTitle = null;

    findMany.mockClear();
    spawn.mockClear();
    findUniqueEdition.mockClear();
    updateEdition.mockClear();
    deleteChapters.mockClear();
    createChapter.mockClear();
    updateBookFile.mockClear();
    transaction.mockClear();
  });

  test("refuses an edition with no audio files", async () => {
    findManyResult = [];

    const result = await registerBookChapters(61);

    expect(result).toEqual({
      chapters: 0,
      totalDurationSecs: 0,
      offlineReady: false,
      reason: "Edition has no audio files",
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

  test("single file with chapter atoms builds a timeline on one bookFileId", async () => {
    findManyResult = [
      { id: 65, filePath: "/library/Book/book.m4b", fileName: "book.m4b" },
    ];
    probeResults = new Map([["/library/Book/book.m4b", 300]]);
    atomResults = new Map([
      [
        "/library/Book/book.m4b",
        [
          {
            start_time: "0.000000",
            end_time: "100.000000",
            tags: { title: "Chapter 1" },
          },
          {
            start_time: "100.000000",
            end_time: "200.000000",
            tags: { title: "Chapter 2" },
          },
          {
            start_time: "200.000000",
            end_time: "300.500000",
            tags: { title: "Chapter 3" },
          },
        ],
      ],
    ]);

    const result = await registerBookChapters(65);

    expect(result).toEqual({
      chapters: 3,
      totalDurationSecs: 300,
      offlineReady: true,
    });

    const created = chapterCreateCalls().map((arg) => arg.data);
    expect(created).toEqual([
      {
        editionId: 65,
        bookFileId: 65,
        index: 0,
        title: "Chapter 1",
        startSecs: 0,
        endSecs: 100,
      },
      {
        editionId: 65,
        bookFileId: 65,
        index: 1,
        title: "Chapter 2",
        startSecs: 100,
        endSecs: 200,
      },
      {
        // Last atom's end (300.5) is clamped down to the probed total (300).
        editionId: 65,
        bookFileId: 65,
        index: 2,
        title: "Chapter 3",
        startSecs: 200,
        endSecs: 300,
      },
    ]);
    expect(new Set(created.map((chapter) => chapter.bookFileId))).toEqual(
      new Set([65]),
    );
    expect(updateEdition).toHaveBeenCalledWith({
      where: { id: 65 },
      data: { offlineReady: true },
    });
    expect(updateBookFile).toHaveBeenCalledWith({
      where: { id: 65 },
      data: { chapterIndex: 0 },
    });
  });

  test("single file with no chapter atoms falls back to one chapter spanning the file", async () => {
    findManyResult = [
      { id: 65, filePath: "/library/Book/book.m4b", fileName: "book.m4b" },
    ];
    probeResults = new Map([["/library/Book/book.m4b", 3600]]);
    atomResults = new Map();
    editionBookTitle = "La femme de ménage voit tout";

    const result = await registerBookChapters(65);

    expect(result).toEqual({
      chapters: 1,
      totalDurationSecs: 3600,
      offlineReady: true,
    });

    const created = chapterCreateCalls().map((arg) => arg.data);
    expect(created).toEqual([
      {
        editionId: 65,
        bookFileId: 65,
        index: 0,
        title: "La femme de ménage voit tout",
        startSecs: 0,
        endSecs: 3600,
      },
    ]);
    expect(updateBookFile).toHaveBeenCalledWith({
      where: { id: 65 },
      data: { chapterIndex: 0 },
    });
  });

  test("single-file fallback uses the file name when the book has no title", async () => {
    findManyResult = [
      {
        id: 65,
        filePath: "/library/Book/Prologue.m4b",
        fileName: "Prologue.m4b",
      },
    ];
    probeResults = new Map([["/library/Book/Prologue.m4b", 120]]);
    atomResults = new Map();
    editionBookTitle = null;

    const result = await registerBookChapters(65);

    expect(result.chapters).toBe(1);
    expect(chapterCreateCalls().at(0)?.data.title).toBe("Prologue");
  });

  test("single file with inconsistent atoms falls back to one chapter", async () => {
    findManyResult = [
      { id: 65, filePath: "/library/Book/book.m4b", fileName: "book.m4b" },
    ];
    probeResults = new Map([["/library/Book/book.m4b", 300]]);
    // Overlapping atoms: chapter 2 starts before chapter 1 ends.
    atomResults = new Map([
      [
        "/library/Book/book.m4b",
        [
          {
            start_time: "0.000000",
            end_time: "200.000000",
            tags: { title: "One" },
          },
          {
            start_time: "100.000000",
            end_time: "300.000000",
            tags: { title: "Two" },
          },
        ],
      ],
    ]);
    editionBookTitle = "Whole Book";

    const result = await registerBookChapters(65);

    expect(result).toEqual({
      chapters: 1,
      totalDurationSecs: 300,
      offlineReady: true,
    });
    const created = chapterCreateCalls().map((arg) => arg.data);
    expect(created).toEqual([
      {
        editionId: 65,
        bookFileId: 65,
        index: 0,
        title: "Whole Book",
        startSecs: 0,
        endSecs: 300,
      },
    ]);
  });

  test("single file with an unprobeable duration is still refused", async () => {
    findManyResult = [
      { id: 65, filePath: "/library/Book/book.m4b", fileName: "book.m4b" },
    ];
    probeResults = new Map(); // duration unprobeable
    atomResults = new Map([
      [
        "/library/Book/book.m4b",
        [
          {
            start_time: "0.000000",
            end_time: "100.000000",
            tags: { title: "One" },
          },
        ],
      ],
    ]);

    const result = await registerBookChapters(65);

    expect(result).toEqual({
      chapters: 0,
      totalDurationSecs: 0,
      offlineReady: false,
      reason: "Could not probe book.m4b",
    });
    expect(updateEdition).toHaveBeenCalledWith({
      where: { id: 65 },
      data: { offlineReady: false },
    });
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
