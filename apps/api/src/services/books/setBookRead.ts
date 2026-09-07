/**
 * Per-user "I finished this book" flag.
 *
 * Progress lives per edition (ebook spine vs audiobook seconds). The flag is
 * on the book, so marking read wipes every edition this user has started.
 * Unmarking drops the badge only — wiped progress is not restored.
 */

export type SetBookReadDb = {
  libraryBook: {
    findUnique: (args: {
      where: { id: number };
      select: { id: true };
    }) => Promise<{ id: number } | null>;
  };
  bookEdition: {
    findMany: (args: {
      where: { bookId: number };
      select: { id: true };
    }) => Promise<{ id: number }[]>;
  };
  bookReadState: {
    upsert: (args: {
      where: { userId_bookId: { userId: string; bookId: number } };
      create: { userId: string; bookId: number; readAt: Date };
      update: { readAt: Date };
    }) => Promise<{ readAt: Date }>;
    deleteMany: (args: {
      where: { userId: string; bookId: number };
    }) => Promise<unknown>;
  };
  bookListeningProgress: {
    deleteMany: (args: {
      where: { userId: string; editionId: { in: number[] } };
    }) => Promise<unknown>;
  };
  bookReadingProgress: {
    deleteMany: (args: {
      where: { userId: string; editionId: { in: number[] } };
    }) => Promise<unknown>;
  };
  $transaction: <T>(
    fn: (tx: Omit<SetBookReadDb, "libraryBook" | "$transaction">) => Promise<T>,
  ) => Promise<T>;
};

export type ReadAtLookupDb = {
  bookReadState: {
    findMany: (args: {
      where: { userId: string; bookId: { in: number[] } };
      select: { bookId: true; readAt: true };
    }) => Promise<{ bookId: number; readAt: Date }[]>;
  };
};

export type SetBookReadResult =
  | { ok: true; readAt: Date | null }
  | { ok: false; reason: "not_found" };

export async function setBookRead(
  db: SetBookReadDb,
  opts: { userId: string; bookId: number; read: boolean },
): Promise<SetBookReadResult> {
  const book = await db.libraryBook.findUnique({
    where: { id: opts.bookId },
    select: { id: true },
  });
  if (!book) return { ok: false, reason: "not_found" };

  if (!opts.read) {
    await db.$transaction(async (tx) => {
      await tx.bookReadState.deleteMany({
        where: { userId: opts.userId, bookId: opts.bookId },
      });
    });
    return { ok: true, readAt: null };
  }

  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    const saved = await tx.bookReadState.upsert({
      where: { userId_bookId: { userId: opts.userId, bookId: opts.bookId } },
      create: { userId: opts.userId, bookId: opts.bookId, readAt: now },
      update: { readAt: now },
    });
    const editions = await tx.bookEdition.findMany({
      where: { bookId: opts.bookId },
      select: { id: true },
    });
    const editionIds = editions.map((e) => e.id);
    if (editionIds.length > 0) {
      await tx.bookListeningProgress.deleteMany({
        where: { userId: opts.userId, editionId: { in: editionIds } },
      });
      await tx.bookReadingProgress.deleteMany({
        where: { userId: opts.userId, editionId: { in: editionIds } },
      });
    }
    return saved;
  });

  return { ok: true, readAt: row.readAt };
}

export async function loadReadAtByBookId(
  db: ReadAtLookupDb,
  userId: string,
  bookIds: number[],
): Promise<Map<number, Date>> {
  if (bookIds.length === 0) return new Map();
  const rows = await db.bookReadState.findMany({
    where: { userId, bookId: { in: bookIds } },
    select: { bookId: true, readAt: true },
  });
  return new Map(rows.map((r) => [r.bookId, r.readAt]));
}
