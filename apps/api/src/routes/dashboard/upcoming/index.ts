import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import {
  TMDB_UPCOMING_CACHE_KEY,
  collectTmdbUpcoming,
  getTmdbUpcomingDateWindowIso,
} from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import {
  attachLibraryIds,
  collectLibraryUpcoming,
  mergeUpcomingById,
} from "@rawkoon/api/utils/dashboard/libraryUpcoming";
import { prisma } from "@rawkoon/api/db";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import {
  deleteCache,
  getJsonCache,
  setJsonCache,
} from "@rawkoon/api/services/cache";
import { normalizeTmdbConfig } from "@rawkoon/api/utils/integrations/normalizers";
import type { DashboardUpcomingItem } from "@rawkoon/api/types/dashboardUpcoming";
import { badGateway, badRequest, serverError } from "@rawkoon/api/errors";
import { addOrUpdateLibraryFromTmdb } from "@rawkoon/api/services/libraryFromTmdb";

const buildUpcomingPayload = async (
  tmdbApiKey: string,
  popularityThreshold: number,
  region: string,
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

export const dashboardUpcomingRoutes = new Elysia()
  .use(auth)
  .use(requireUser)
  .get("/upcoming", async ({ set }) => {
    try {
      const region = await getGlobalTmdbRegion();
      const tmdbIntegration = await getIntegrationConfigRecord("tmdb");
      const tmdbConfig = tmdbIntegration?.enabled
        ? normalizeTmdbConfig(tmdbIntegration.config)
        : null;
      const tmdbApiKey = tmdbConfig?.api_key ?? null;

      if (!tmdbApiKey) {
        return { enabled: false, items: [] };
      }

      const cached = await getJsonCache<{
        enabled: boolean;
        items: DashboardUpcomingItem[];
      }>(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);

      if (cached) {
        return cached;
      }

      console.log("[upcoming] Cache miss, running inline fallback");
      const popularityThreshold = tmdbConfig?.popularity_threshold ?? 15;
      const responsePayload = await buildUpcomingPayload(
        tmdbApiKey,
        popularityThreshold,
        region,
      );
      if (!responsePayload) return badGateway(set, "TMDB request failed");
      await setJsonCache(
        `${TMDB_UPCOMING_CACHE_KEY}:${region}`,
        responsePayload,
        60 * 60,
      );
      return responsePayload;
    } catch (error) {
      console.error("Error getting TMDB upcoming items:", error);
      return serverError(set, "Failed to get TMDB upcoming items");
    }
  })
  .post("/upcoming/refresh", async ({ set }) => {
    try {
      const region = await getGlobalTmdbRegion();
      const tmdbIntegration = await getIntegrationConfigRecord("tmdb");
      const tmdbConfig = tmdbIntegration?.enabled
        ? normalizeTmdbConfig(tmdbIntegration.config)
        : null;
      const tmdbApiKey = tmdbConfig?.api_key ?? null;

      await deleteCache(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);

      if (!tmdbApiKey) {
        return { enabled: false, items: [] };
      }

      const popularityThreshold = tmdbConfig?.popularity_threshold ?? 15;
      const responsePayload = await buildUpcomingPayload(
        tmdbApiKey,
        popularityThreshold,
        region,
      );
      if (!responsePayload) return badGateway(set, "TMDB request failed");

      await setJsonCache(
        `${TMDB_UPCOMING_CACHE_KEY}:${region}`,
        responsePayload,
        60 * 60,
      );
      return responsePayload;
    } catch (error) {
      console.error("Error refreshing TMDB upcoming items:", error);
      return serverError(set, "Failed to refresh TMDB upcoming items");
    }
  })
  .post(
    "/upcoming/add",
    async ({ body, set }) => {
      const { media_type: mediaType, tmdb_id: tmdbId } = body;

      try {
        const region = await getGlobalTmdbRegion();
        const libType = mediaType === "movie" ? "movie" : "show";
        // tmdbId is globally unique in LibraryMedia and addOrUpdateLibraryFromTmdb
        // upserts by tmdbId alone, so treat ANY row with this tmdbId as occupied:
        // a type-scoped lookup would let a show add clobber a same-id movie row.
        // (Revisit if the schema moves to a composite [tmdbId, type] key.)
        const existing = await prisma.libraryMedia.findUnique({
          where: { tmdbId },
        });
        if (existing) {
          await deleteCache(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);
          return {
            success: true,
            added: false,
            already_exists: true,
          };
        }

        await addOrUpdateLibraryFromTmdb({
          tmdb_id: tmdbId,
          type: libType,
          region,
        });
        await deleteCache(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);

        return {
          success: true,
          added: true,
          already_exists: false,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg === "TMDB is not configured") {
          return badRequest(set, msg);
        }
        console.error("Error adding upcoming item to library:", error);
        return serverError(set, "Failed to add upcoming item");
      }
    },
    {
      body: t.Object({
        media_type: t.Union([t.Literal("movie"), t.Literal("tv")]),
        tmdb_id: t.Numeric(),
      }),
    },
  )
  .post(
    "/upcoming/status",
    async ({ body, set }) => {
      const { tmdb_id: tmdbId } = body;

      try {
        const row = await prisma.libraryMedia.findUnique({
          where: { tmdbId },
          select: { id: true },
        });

        return {
          exists: Boolean(row),
          library_id: row?.id ?? null,
        };
      } catch (error) {
        console.error("Error checking upcoming item status", error);
        return serverError(set, "Failed to check upcoming item status");
      }
    },
    {
      body: t.Object({
        media_type: t.Union([t.Literal("movie"), t.Literal("tv")]),
        tmdb_id: t.Numeric(),
      }),
    },
  );
