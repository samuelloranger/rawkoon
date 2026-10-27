import { prisma } from "@rawkoon/api/db";

export type DismissalType = "movie" | "tv";

export function dismissDiscoverTitle(
  userId: string,
  tmdbId: number,
  mediaType: DismissalType,
) {
  return prisma.discoverDismissal.upsert({
    where: { userId_tmdbId_mediaType: { userId, tmdbId, mediaType } },
    create: { userId, tmdbId, mediaType },
    update: {},
  });
}

export function undoDiscoverDismissal(
  userId: string,
  tmdbId: number,
  mediaType: DismissalType,
) {
  return prisma.discoverDismissal.deleteMany({
    where: { userId, tmdbId, mediaType },
  });
}
