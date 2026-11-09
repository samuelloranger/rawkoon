import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { queryV } from "@rawkoon/api/middleware/validate";
import {
  DEFAULT_UPCOMING_LANGUAGE,
  collectTmdbUpcoming,
  getTmdbUpcomingDateWindowIso,
  upcomingCacheKey,
} from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import { toTmdbLanguage } from "@rawkoon/api/utils/medias/tmdbFetcherCore";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import {
  attachLibraryIds,
  collectLibraryUpcoming,
  mergeUpcomingById,
} from "@rawkoon/api/utils/dashboard/libraryUpcoming";
import { buildUpcomingPayload } from "@rawkoon/api/services/dashboard/upcomingPayload";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { normalizeTmdbConfig } from "@rawkoon/api/utils/integrations/normalizers";
import type { DashboardUpcomingItem } from "@rawkoon/api/types/dashboardUpcoming";
import { badGateway, ok, serverError } from "@rawkoon/api/errors";

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
  );
