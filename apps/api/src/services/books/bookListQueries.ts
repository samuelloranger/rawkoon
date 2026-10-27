import type { Prisma } from "@prisma/client";

import { prisma } from "@rawkoon/api/db";
import { bookInclude } from "@rawkoon/api/routes/books/bookHelpers";
import { deleteLibraryBookWithRequests } from "@rawkoon/api/services/mediaRequests";
import {
  loadReadAtByBookId,
  resetBookProgress,
  setBookRead,
} from "@rawkoon/api/services/books/setBookRead";
import type { BookEditionKind } from "@rawkoon/shared/types";

type ListQuery = {
  q?: string;
  kind?: BookEditionKind;
  status?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_dir?: string;
};

export async function listBooksPage(userId: string, query: ListQuery) {
  const { q, kind, status, page, limit, sort_by, sort_dir } = query;

  const where: Prisma.LibraryBookWhereInput = {
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    ...(kind || status
      ? {
          editions: {
            some: {
              ...(kind ? { kind } : {}),
              ...(status ? { status } : {}),
            },
          },
        }
      : {}),
  };

  const dir = sort_dir === "asc" ? "asc" : "desc";
  const orderBy: Prisma.LibraryBookOrderByWithRelationInput =
    sort_by === "title"
      ? { listTitle: dir }
      : sort_by === "year"
        ? { listYear: dir }
        : { addedAt: dir };

  const take = Math.min(200, Math.max(1, limit ?? 50));
  const skip = Math.max(0, ((page ?? 1) - 1) * take);

  const [total, rows] = await Promise.all([
    prisma.libraryBook.count({ where }),
    prisma.libraryBook.findMany({
      where,
      orderBy,
      include: bookInclude,
      skip,
      take: take + 1,
    }),
  ]);

  const hasMore = rows.length > take;
  const listed = hasMore ? rows.slice(0, take) : rows;
  const readAt = await loadReadAtByBookId(
    prisma,
    userId,
    listed.map((b) => b.id),
  );
  return { listed, total, hasMore, readAt };
}

export const findLibraryBooksByVolumeIds = (volumeIds: string[]) =>
  prisma.libraryBook.findMany({
    where: { googleVolumeId: { in: volumeIds } },
    select: { id: true, googleVolumeId: true },
  });

export const findBookDetail = (id: number) =>
  prisma.libraryBook.findUnique({ where: { id }, include: bookInclude });

export async function findBookDetailWithReadAt(userId: string, id: number) {
  const book = await findBookDetail(id);
  if (!book) return null;
  const readAt = await loadReadAtByBookId(prisma, userId, [book.id]);
  return { book, readAt: readAt.get(book.id) ?? null };
}

export async function markBookRead(userId: string, id: number, read: boolean) {
  const result = await setBookRead(prisma, { userId, bookId: id, read });
  if (!result.ok) return null;
  const book = await findBookDetail(id);
  if (!book) return null;
  return { book, readAt: result.readAt };
}

export async function resetProgressForBook(
  userId: string,
  id: number,
): Promise<boolean> {
  const result = await resetBookProgress(prisma, { userId, bookId: id });
  return result.ok;
}

export async function removeBook(id: number): Promise<boolean> {
  const existing = await prisma.libraryBook.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return false;
  // A grab still downloading can never import once its edition is gone.
  const pending = await prisma.downloadHistory.findMany({
    where: { bookEdition: { bookId: id }, completedAt: null, failed: false },
    select: { id: true, torrentHash: true },
  });
  const { abandonPendingDownloads } = await import(
    "@rawkoon/api/services/seeding/seedSweep"
  );
  await abandonPendingDownloads(pending);
  // Editions and files cascade; library files on disk are left alone,
  // matching how removing a library media item behaves. Completed grabs keep
  // their rows (book_edition_id → NULL) so their torrents seed to target.
  await deleteLibraryBookWithRequests(id);
  return true;
}
