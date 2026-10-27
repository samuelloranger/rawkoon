import { prisma } from "@rawkoon/api/db";
import {
  DEFAULT_UPCOMING_LANGUAGE,
  collectTmdbUpcoming,
  getTmdbUpcomingDateWindowIso,
} from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import {
  attachLibraryIds,
  collectLibraryUpcoming,
  mergeUpcomingById,
} from "@rawkoon/api/utils/dashboard/libraryUpcoming";
import type { DashboardUpcomingItem } from "@rawkoon/api/types/dashboardUpcoming";

export const buildUpcomingPayload = async (
  tmdbApiKey: string,
  popularityThreshold: number,
  region: string,
  tmdbLanguage: string = DEFAULT_UPCOMING_LANGUAGE,
): Promise<{ enabled: true; items: DashboardUpcomingItem[] } | null> => {
  const appSettings = await prisma.appSettings.findUnique({
    where: { id: 1 },
  });

  const upcomingWindowMonths = appSettings?.upcomingWindowMonths ?? 12;
  const upcomingLanguages = appSettings?.upcomingLanguages ?? "en,fr";
  const { todayIso, endDateIso } =
    getTmdbUpcomingDateWindowIso(upcomingWindowMonths);

  const POOL_SIZE_PER_TYPE = 40;
  const [moviesResult, tvResult] = await Promise.all([
    collectTmdbUpcoming(
      "movie",
      POOL_SIZE_PER_TYPE,
      tmdbApiKey,
      todayIso,
      endDateIso,
      region,
      upcomingLanguages,
      tmdbLanguage,
    ),
    collectTmdbUpcoming(
      "tv",
      POOL_SIZE_PER_TYPE,
      tmdbApiKey,
      todayIso,
      endDateIso,
      region,
      upcomingLanguages,
      tmdbLanguage,
    ),
  ]);

  if (!moviesResult || !tvResult) return null;

  const filteredTv = tvResult.items.filter(
    (item) => (item.popularity ?? 0) >= popularityThreshold,
  );

  const libraryItems = await collectLibraryUpcoming(todayIso, endDateIso);
  const mergedItems = mergeUpcomingById(
    [
      ...moviesResult.items.filter(
        (item) => (item.popularity ?? 0) >= popularityThreshold,
      ),
      ...filteredTv,
    ],
    libraryItems,
  );

  const sortedItems = (await attachLibraryIds(mergedItems))
    .filter((item) => {
      if (!item.release_date) return false;
      const releaseTime = Date.parse(item.release_date);
      const todayTime = Date.parse(todayIso);
      const endTime = Date.parse(endDateIso);
      return (
        Number.isFinite(releaseTime) &&
        releaseTime >= todayTime &&
        releaseTime <= endTime
      );
    })
    .sort((a, b) => {
      const aTime = a.release_date
        ? Date.parse(a.release_date)
        : Number.POSITIVE_INFINITY;
      const bTime = b.release_date
        ? Date.parse(b.release_date)
        : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });

  const cleanItems: DashboardUpcomingItem[] = sortedItems.map(
    ({ popularity: _, ...rest }) => rest,
  );

  return { enabled: true, items: cleanItems };
};

export const findLibraryMediaByTmdbId = (
  tmdbId: number,
  type: "movie" | "show",
) =>
  prisma.libraryMedia.findUnique({
    where: { tmdbId_type: { tmdbId, type } },
    select: { id: true },
  });
