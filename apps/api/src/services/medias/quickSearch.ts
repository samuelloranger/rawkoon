import type { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";

export function searchUsers(q: string, limit: number, includeEmail: boolean) {
  const or: Prisma.UserWhereInput[] = [
    { firstName: { contains: q, mode: "insensitive" } },
    { lastName: { contains: q, mode: "insensitive" } },
  ];
  if (includeEmail) {
    or.push({ email: { contains: q, mode: "insensitive" } });
  }
  return prisma.user.findMany({
    where: { OR: or },
    take: limit,
    select: { id: true, firstName: true, lastName: true, email: true },
  });
}

export function searchLibraryMedias(q: string, limit: number) {
  return prisma.libraryMedia.findMany({
    where: { title: { contains: q, mode: "insensitive" } },
    take: limit,
    select: { id: true, title: true, type: true, year: true, status: true },
  });
}

/** Empty unless books are enabled, so a movies-only install skips the query. */
export async function searchLibraryBooks(q: string, limit: number) {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { booksEnabled: true },
  });
  if (settings?.booksEnabled !== true) return [];
  const rows = await prisma.libraryBook.findMany({
    where: { title: { contains: q, mode: "insensitive" } },
    take: limit,
    orderBy: { listTitle: "asc" },
    select: { id: true, title: true, authors: true, listYear: true },
  });
  return rows.map((b) => ({
    id: b.id,
    title: b.title,
    authors: b.authors,
    year: b.listYear,
  }));
}
