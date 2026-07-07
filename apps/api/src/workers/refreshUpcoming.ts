import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeTmdbConfig } from "@rawkoon/api/utils/integrations/normalizers";
import {
  collectTmdbUpcoming,
  fetchMovieReleaseDates,
  fetchTmdbProviders,
  getTmdbUpcomingDateWindowIso,
  parseTmdbNumericId,
  TMDB_UPCOMING_CACHE_KEY,
  TMDB_UPCOMING_CACHE_TTL_SECONDS,
} from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import {
  attachLibraryIds,
  collectLibraryUpcoming,
  mergeUpcomingById,
} from "@rawkoon/api/utils/dashboard/libraryUpcoming";
import { setJsonCache } from "@rawkoon/api/services/cache";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import type { DashboardUpcomingItem } from "@rawkoon/api/types/dashboardUpcoming";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import { prisma } from "@rawkoon/api/db";

const JOB_ID = "refreshUpcoming";
const JOB_NAME = "Refresh upcoming releases";
const BATCH_SIZE = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const processBatch = async <T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    if (i > 0) await sleep(3000); // 3s between batches to respect TMDB rate limits
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
};

export const refreshUpcoming = async (options?: {
  trigger?: "cron" | "manual" | "queue";
}): Promise<void> => {
  const trigger = options?.trigger ?? "cron";
  const startedAt = Date.now();

  try {
    const tmdbIntegration = await getIntegrationConfigRecord("tmdb");
    const tmdbConfig = tmdbIntegration?.enabled
      ? normalizeTmdbConfig(tmdbIntegration.config)
      : null;
    const tmdbApiKey = tmdbConfig?.api_key ?? null;

    if (!tmdbApiKey) {
      console.log("[cron:upcoming] TMDB integration not configured, skipping");
      return;
    }

    const region = await getGlobalTmdbRegion();
    const appSettings = await prisma.appSettings.findUnique({
      where: { id: 1 },
    });

    const upcomingWindowMonths = appSettings?.upcomingWindowMonths ?? 12;
    const upcomingLanguages = appSettings?.upcomingLanguages ?? "en,fr";
    const { todayIso, endDateIso } =
      getTmdbUpcomingDateWindowIso(upcomingWindowMonths);

    const POOL_SIZE_PER_TYPE = 60;
    const [moviesResult, tvResult] = await Promise.all([
      collectTmdbUpcoming(
        "movie",
        POOL_SIZE_PER_TYPE,
        tmdbApiKey,
        todayIso,
        endDateIso,
        region,
        upcomingLanguages,
      ),
      collectTmdbUpcoming(
        "tv",
        POOL_SIZE_PER_TYPE,
        tmdbApiKey,
        todayIso,
        endDateIso,
        region,
        upcomingLanguages,
      ),
    ]);

    if (!moviesResult || !tvResult) {
      console.error("[cron:upcoming] TMDB discover request failed");
      await logActivity({
        type: "cron_job_ended",
        payload: {
          job_id: JOB_ID,
          job_name: JOB_NAME,
          success: false,
          duration_ms: Date.now() - startedAt,
          trigger,
          message: "TMDB discover request failed",
        },
      });
      return;
    }

    const popularityThreshold = tmdbConfig?.popularity_threshold ?? 15;
    const filteredMovies = moviesResult.items.filter(
      (item) => (item.popularity ?? 0) >= popularityThreshold,
    );
    const filteredTv = tvResult.items.filter(
      (item) => (item.popularity ?? 0) >= popularityThreshold,
    );

    const libraryItems = await collectLibraryUpcoming(todayIso, endDateIso);
    const baseItems = await attachLibraryIds(
      mergeUpcomingById([...filteredMovies, ...filteredTv], libraryItems),
    );

    console.log(
      `[cron:upcoming] After popularity filter + library merge: ${filteredMovies.length} movies, ${filteredTv.length} TV rows, ${libraryItems.length} library items (${baseItems.length} total)`,
    );

    const enrichedItems = await processBatch(
      baseItems,
      BATCH_SIZE,
      async (item) => {
        if (item.media_type !== "movie") return item;
        const numericId = parseTmdbNumericId(item.id);
        if (!numericId) return item;

        const digitalDate = await fetchMovieReleaseDates(
          numericId,
          tmdbApiKey,
          region,
        );
        if (digitalDate) {
          return { ...item, release_date: digitalDate };
        }
        return item;
      },
    );

    const allItems = enrichedItems.filter((item) => {
      if (!item.release_date) return false;
      const releaseTime = Date.parse(item.release_date);
      return (
        Number.isFinite(releaseTime) && releaseTime >= Date.parse(todayIso)
      );
    });

    const sortedItems = allItems.sort((a, b) => {
      const aTime = a.release_date
        ? Date.parse(a.release_date)
        : Number.POSITIVE_INFINITY;
      const bTime = b.release_date
        ? Date.parse(b.release_date)
        : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });

    const itemsWithProviders = await processBatch(
      sortedItems,
      BATCH_SIZE,
      async (item) => {
        const tmdbId = parseTmdbNumericId(item.id);
        if (!tmdbId) return item;
        const providers = await fetchTmdbProviders(
          item.media_type,
          tmdbId,
          tmdbApiKey,
          region,
        );
        return { ...item, providers };
      },
    );

    const cacheItems: DashboardUpcomingItem[] = itemsWithProviders.map(
      ({ popularity: _, ...rest }) => rest,
    );

    const responsePayload = { enabled: true, items: cacheItems };
    await setJsonCache(
      `${TMDB_UPCOMING_CACHE_KEY}:${region}`,
      responsePayload,
      TMDB_UPCOMING_CACHE_TTL_SECONDS,
    );

    console.log(`[cron:upcoming] Cached ${cacheItems.length} upcoming items`);
    await logActivity({
      type: "cron_job_ended",
      payload: {
        job_id: JOB_ID,
        job_name: JOB_NAME,
        success: true,
        duration_ms: Date.now() - startedAt,
        trigger,
        message: `Cached ${cacheItems.length} items`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[cron:upcoming] Failed:", message);
    await logActivity({
      type: "cron_job_ended",
      payload: {
        job_id: JOB_ID,
        job_name: JOB_NAME,
        success: false,
        duration_ms: Date.now() - startedAt,
        trigger,
        message,
      },
    });
    throw error; // Rethrow for BullMQ
  }
};
