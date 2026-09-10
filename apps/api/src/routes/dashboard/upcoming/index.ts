import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
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
import { badGateway, badRequest, ok, serverError } from "@rawkoon/api/errors";
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

const upcomingItemBody = z.object({
  media_type: z.union([z.literal("movie"), z.literal("tv")]),
  tmdb_id: z.coerce.number(),
});

export const dashboardUpcomingRoutes = new Hono<Env>()
  .use("*", requireUser)
  .get("/upcoming", async () => {
    try {
      const region = await getGlobalTmdbRegion();
      const tmdbIntegration = await getIntegrationConfigRecord("tmdb");
      const tmdbConfig = tmdbIntegration?.enabled
        ? normalizeTmdbConfig(tmdbIntegration.config)
        : null;
      const tmdbApiKey = tmdbConfig?.api_key ?? null;

      if (!tmdbApiKey) {
        return ok({ enabled: false, items: [] });
      }

      const cached = await getJsonCache<{
        enabled: boolean;
        items: DashboardUpcomingItem[];
      }>(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);

      if (cached) {
        return ok(cached);
      }

      console.log("[upcoming] Cache miss, running inline fallback");
      const popularityThreshold = tmdbConfig?.popularity_threshold ?? 15;
      const responsePayload = await buildUpcomingPayload(
        tmdbApiKey,
        popularityThreshold,
        region,
      );
      if (!responsePayload) return badGateway("TMDB request failed");
      await setJsonCache(
        `${TMDB_UPCOMING_CACHE_KEY}:${region}`,
        responsePayload,
        60 * 60,
      );
      return ok(responsePayload);
    } catch (error) {
      console.error("Error getting TMDB upcoming items:", error);
      return serverError("Failed to get TMDB upcoming items");
    }
  })
  .post("/upcoming/refresh", async () => {
    try {
      const region = await getGlobalTmdbRegion();
      const tmdbIntegration = await getIntegrationConfigRecord("tmdb");
      const tmdbConfig = tmdbIntegration?.enabled
        ? normalizeTmdbConfig(tmdbIntegration.config)
        : null;
      const tmdbApiKey = tmdbConfig?.api_key ?? null;

      await deleteCache(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);

      if (!tmdbApiKey) {
        return ok({ enabled: false, items: [] });
      }

      const popularityThreshold = tmdbConfig?.popularity_threshold ?? 15;
      const responsePayload = await buildUpcomingPayload(
        tmdbApiKey,
        popularityThreshold,
        region,
      );
      if (!responsePayload) return badGateway("TMDB request failed");

      await setJsonCache(
        `${TMDB_UPCOMING_CACHE_KEY}:${region}`,
        responsePayload,
        60 * 60,
      );
      return ok(responsePayload);
    } catch (error) {
      console.error("Error refreshing TMDB upcoming items:", error);
      return serverError("Failed to refresh TMDB upcoming items");
    }
  })
  .post("/upcoming/add", jsonV(upcomingItemBody), async (c) => {
    const { tmdb_id: tmdbId } = c.req.valid("json");
    const mediaType = c.req.valid("json").media_type;

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
        return ok({ success: true, added: false, already_exists: true });
      }

      await addOrUpdateLibraryFromTmdb({
        tmdb_id: tmdbId,
        type: libType,
        region,
      });
      await deleteCache(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);

      return ok({ success: true, added: true, already_exists: false });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "TMDB is not configured") {
        return badRequest(msg);
      }
      console.error("Error adding upcoming item to library:", error);
      return serverError("Failed to add upcoming item");
    }
  })
  .post("/upcoming/status", jsonV(upcomingItemBody), async (c) => {
    const { tmdb_id: tmdbId } = c.req.valid("json");

    try {
      const row = await prisma.libraryMedia.findUnique({
        where: { tmdbId },
        select: { id: true },
      });

      return ok({ exists: Boolean(row), library_id: row?.id ?? null });
    } catch (error) {
      console.error("Error checking upcoming item status", error);
      return serverError("Failed to check upcoming item status");
    }
  });
