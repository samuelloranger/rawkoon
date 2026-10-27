import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import {
  DEFAULT_UPCOMING_LANGUAGE,
  TMDB_UPCOMING_CACHE_KEY,
  collectTmdbUpcoming,
  getTmdbUpcomingDateWindowIso,
  invalidateUpcomingCache,
  upcomingCacheKey,
} from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import { toTmdbLanguage } from "@rawkoon/api/utils/medias/tmdbFetcherCore";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import {
  attachLibraryIds,
  collectLibraryUpcoming,
  mergeUpcomingById,
} from "@rawkoon/api/utils/dashboard/libraryUpcoming";
import {
  buildUpcomingPayload,
  findLibraryMediaByTmdbId,
} from "@rawkoon/api/services/dashboard/upcomingPayload";
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

const upcomingItemBody = z.object({
  media_type: z.union([z.literal("movie"), z.literal("tv")]),
  tmdb_id: z.coerce.number(),
});

export const dashboardUpcomingRoutes = new Hono<Env>()
  .use("*", requireUser)
  .get(
    "/upcoming",
    queryV(z.object({ language: z.string().optional() })),
    async (c) => {
      const language = toTmdbLanguage(
        c.req.valid("query").language || DEFAULT_UPCOMING_LANGUAGE,
      );
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
        }>(upcomingCacheKey(region, language));

        if (cached) {
          return ok(cached);
        }

        console.log("[upcoming] Cache miss, running inline fallback");
        const popularityThreshold = tmdbConfig?.popularity_threshold ?? 15;
        const responsePayload = await buildUpcomingPayload(
          tmdbApiKey,
          popularityThreshold,
          region,
          language,
        );
        if (!responsePayload) return badGateway("TMDB request failed");
        await setJsonCache(
          upcomingCacheKey(region, language),
          responsePayload,
          60 * 60,
        );
        return ok(responsePayload);
      } catch (error) {
        console.error("Error getting TMDB upcoming items:", error);
        return serverError("Failed to get TMDB upcoming items");
      }
    },
  )
  .post("/upcoming/refresh", async () => {
    try {
      const region = await getGlobalTmdbRegion();
      const tmdbIntegration = await getIntegrationConfigRecord("tmdb");
      const tmdbConfig = tmdbIntegration?.enabled
        ? normalizeTmdbConfig(tmdbIntegration.config)
        : null;
      const tmdbApiKey = tmdbConfig?.api_key ?? null;

      await invalidateUpcomingCache(region);

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
      const existing = await findLibraryMediaByTmdbId(tmdbId, libType);
      if (existing) {
        await invalidateUpcomingCache(region);
        return ok({ success: true, added: false, already_exists: true });
      }

      await addOrUpdateLibraryFromTmdb({
        tmdb_id: tmdbId,
        type: libType,
        region,
      });
      await invalidateUpcomingCache(region);

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
    const { tmdb_id: tmdbId, media_type: mediaType } = c.req.valid("json");

    try {
      const row = await findLibraryMediaByTmdbId(
        tmdbId,
        mediaType === "movie" ? "movie" : "show",
      );

      return ok({ exists: Boolean(row), library_id: row?.id ?? null });
    } catch (error) {
      console.error("Error checking upcoming item status", error);
      return serverError("Failed to check upcoming item status");
    }
  });
