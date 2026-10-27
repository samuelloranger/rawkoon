import { prisma } from "@rawkoon/api/db";

export function listWatchlistItems(userId: string) {
  return prisma.watchlistItem.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
  });
}

export function upsertWatchlistItem(input: {
  userId: string;
  tmdbId: number;
  mediaType: string;
  title: string;
  posterUrl: string | null;
  overview: string | null;
  releaseYear: number | null;
  voteAverage: number | null;
  isMovie: boolean;
  movieDate: Date | null;
  releaseDateProvided: boolean;
}) {
  const { userId, tmdbId, mediaType, isMovie, movieDate } = input;
  return prisma.watchlistItem.upsert({
    where: { userId_tmdbId_mediaType: { userId, tmdbId, mediaType } },
    create: {
      userId,
      tmdbId,
      mediaType,
      title: input.title,
      posterUrl: input.posterUrl,
      overview: input.overview,
      releaseYear: input.releaseYear,
      voteAverage: input.voteAverage,
      movieReleaseDate: isMovie ? movieDate : null,
      releaseReminderSentFor: null,
    },
    update: {
      ...(isMovie && input.releaseDateProvided
        ? { movieReleaseDate: movieDate, releaseReminderSentFor: null }
        : {}),
    },
  });
}

export function deleteWatchlistItems(
  userId: string,
  tmdbId: number,
  mediaType: string,
) {
  return prisma.watchlistItem.deleteMany({
    where: { userId, tmdbId, mediaType },
  });
}

export async function findWatchlistItemId(
  userId: string,
  tmdbId: number,
  mediaType: string,
): Promise<number | null> {
  const item = await prisma.watchlistItem.findUnique({
    where: { userId_tmdbId_mediaType: { userId, tmdbId, mediaType } },
    select: { id: true },
  });
  return item?.id ?? null;
}
