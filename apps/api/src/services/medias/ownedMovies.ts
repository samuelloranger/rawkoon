import { prisma } from "@rawkoon/api/db";

/** Capped so TMDB details inspection doesn't rate-limit or time out on large libraries. */
const RECENT_MOVIES_LIMIT = 100;

export async function listOwnedMovieTmdbIds(): Promise<Set<number>> {
  const rows = await prisma.libraryMedia.findMany({
    where: { type: "movie" },
    select: { tmdbId: true },
  });
  return new Set(rows.map((m) => m.tmdbId));
}

export async function listRecentMovieTmdbIds(): Promise<number[]> {
  const rows = await prisma.libraryMedia.findMany({
    where: { type: "movie" },
    select: { tmdbId: true },
    orderBy: { addedAt: "desc" },
    take: RECENT_MOVIES_LIMIT,
  });
  return rows.map((m) => m.tmdbId);
}
