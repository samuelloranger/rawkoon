import { beforeEach, describe, expect, mock, test } from "bun:test";

import { setBookRead, type SetBookReadDb } from "./setBookRead";

type EditionRow = { id: number };
type BookRow = { id: number };

const USER = "user-1";
const OTHER = "user-2";
const BOOK = 10;
const EBOOK = 101;
const AUDIO = 102;
const OTHER_BOOK_EDITION = 999;

function firstCallArg<T>(fn: { mock: { calls: unknown } }): T {
  const calls = fn.mock.calls as unknown as unknown[][];
  return calls[0]![0] as T;
}

function createDb(opts?: { bookExists?: boolean; editions?: EditionRow[] }) {
  const bookExists = opts?.bookExists ?? true;
  const editions = opts?.editions ?? [{ id: EBOOK }, { id: AUDIO }];

  const upsert = mock(async () => ({
    userId: USER,
    bookId: BOOK,
    readAt: new Date(),
  }));
  const deleteReadState = mock(async () => ({ count: 1 }));
  const deleteListening = mock(async () => ({ count: 0 }));
  const deleteReading = mock(async () => ({ count: 0 }));
  const findBook = mock(
    async (): Promise<BookRow | null> => (bookExists ? { id: BOOK } : null),
  );
  const findEditions = mock(async (): Promise<EditionRow[]> => editions);

  const tx = {
    bookEdition: { findMany: findEditions },
    bookReadState: { upsert, deleteMany: deleteReadState },
    bookListeningProgress: { deleteMany: deleteListening },
    bookReadingProgress: { deleteMany: deleteReading },
  };

  const transaction = mock(async (fn: (inner: typeof tx) => Promise<unknown>) =>
    fn(tx),
  );

  return {
    db: {
      libraryBook: { findUnique: findBook },
      $transaction: transaction,
      ...tx,
    } as unknown as SetBookReadDb,
    upsert,
    deleteReadState,
    deleteListening,
    deleteReading,
    findBook,
    findEditions,
    transaction,
  };
}

describe("setBookRead", () => {
  let harness: ReturnType<typeof createDb>;

  beforeEach(() => {
    harness = createDb();
  });

  test("marking read upserts read_at and deletes listening and reading progress for every edition", async () => {
    const result = await setBookRead(harness.db, {
      userId: USER,
      bookId: BOOK,
      read: true,
    });

    expect(result).toEqual({ ok: true, readAt: expect.any(Date) });
    expect(harness.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = firstCallArg<{
      where: { userId_bookId: { userId: string; bookId: number } };
    }>(harness.upsert);
    expect(upsertArgs.where.userId_bookId).toEqual({
      userId: USER,
      bookId: BOOK,
    });

    expect(harness.deleteListening).toHaveBeenCalledTimes(1);
    expect(harness.deleteReading).toHaveBeenCalledTimes(1);
    const listeningWhere = firstCallArg<{
      where: { userId: string; editionId: { in: number[] } };
    }>(harness.deleteListening).where;
    expect(listeningWhere.userId).toBe(USER);
    expect([...listeningWhere.editionId.in].sort()).toEqual(
      [AUDIO, EBOOK].sort(),
    );
    const readingWhere = firstCallArg<{
      where: { userId: string; editionId: { in: number[] } };
    }>(harness.deleteReading).where;
    expect(readingWhere.userId).toBe(USER);
    expect([...readingWhere.editionId.in].sort()).toEqual(
      [AUDIO, EBOOK].sort(),
    );
  });

  test("unmarking clears the read flag and leaves progress rows alone", async () => {
    const result = await setBookRead(harness.db, {
      userId: USER,
      bookId: BOOK,
      read: false,
    });

    expect(result).toEqual({ ok: true, readAt: null });
    expect(harness.deleteReadState).toHaveBeenCalledTimes(1);
    const unmarkArg = firstCallArg<{
      where: { userId: string; bookId: number };
    }>(harness.deleteReadState);
    expect(unmarkArg.where.userId).toBe(USER);
    expect(unmarkArg.where.bookId).toBe(BOOK);
    expect(harness.deleteListening).not.toHaveBeenCalled();
    expect(harness.deleteReading).not.toHaveBeenCalled();
    expect(harness.upsert).not.toHaveBeenCalled();
  });

  test("a book with only one edition still wipes that edition's progress", async () => {
    harness = createDb({ editions: [{ id: AUDIO }] });
    await setBookRead(harness.db, { userId: USER, bookId: BOOK, read: true });

    const listeningWhere = firstCallArg<{
      where: { editionId: { in: number[] } };
    }>(harness.deleteListening).where;
    expect(listeningWhere.editionId.in).toEqual([AUDIO]);
  });

  test("a missing book is not_found and writes nothing", async () => {
    harness = createDb({ bookExists: false });
    const result = await setBookRead(harness.db, {
      userId: USER,
      bookId: BOOK,
      read: true,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.upsert).not.toHaveBeenCalled();
    expect(harness.deleteListening).not.toHaveBeenCalled();
  });

  test("progress deletes are scoped to this user, not other users or other books", async () => {
    harness = createDb({ editions: [{ id: EBOOK }, { id: AUDIO }] });
    await setBookRead(harness.db, { userId: USER, bookId: BOOK, read: true });

    const listeningWhere = firstCallArg<{
      where: { userId: string; editionId: { in: number[] } };
    }>(harness.deleteListening).where;
    expect(listeningWhere.userId).not.toBe(OTHER);
    expect(listeningWhere.editionId.in).not.toContain(OTHER_BOOK_EDITION);
  });
});
