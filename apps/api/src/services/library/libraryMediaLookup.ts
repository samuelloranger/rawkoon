import { prisma } from "@rawkoon/api/db";

export function findLibraryMediaTmdbRef(id: number) {
  return prisma.libraryMedia.findUnique({
    where: { id },
    select: { tmdbId: true, type: true },
  });
}
