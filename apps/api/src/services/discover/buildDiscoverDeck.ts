import type { DiscoverDeckResponse } from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { loadAllLibraryTmdbIds } from "@rawkoon/api/routes/medias/tmdb/tmdbRouteHelpers";
import { assembleDeck, MIN_SEEDS } from "./assembleDeck";
import type { RecommendationProvider } from "./types";

interface BuildInput {
  provider: RecommendationProvider;
  userId: string;
  language: string;
  excludeTmdbIds: number[];
  limit: number;
}

export async function buildDiscoverDeck(
  input: BuildInput,
): Promise<DiscoverDeckResponse> {
  const { allTmdbIds, movieTmdbIds, showTmdbIds } =
    await loadAllLibraryTmdbIds();

  const dismissals = await prisma.discoverDismissal.findMany({
    where: { userId: input.userId },
    select: { tmdbId: true },
  });

  const excludedTmdbIds = new Set<number>(allTmdbIds);
  for (const d of dismissals) excludedTmdbIds.add(d.tmdbId);
  for (const id of input.excludeTmdbIds) excludedTmdbIds.add(id);

  const seedCount = movieTmdbIds.length + showTmdbIds.length;

  const seededCandidates =
    seedCount >= MIN_SEEDS
      ? await input.provider.getSeededCandidates({
          movieTmdbIds,
          showTmdbIds,
          language: input.language,
        })
      : [];

  const fallbackCandidates = await input.provider.getFallbackCandidates({
    language: input.language,
  });

  return assembleDeck({
    seedCount,
    seededCandidates,
    fallbackCandidates,
    excludedTmdbIds,
    limit: input.limit,
  });
}
