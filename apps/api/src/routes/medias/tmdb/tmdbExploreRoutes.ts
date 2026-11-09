import { Hono } from "hono";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { badGateway, badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import {
  type TmdbSearchItem,
  mapTmdbSearchItem,
} from "@rawkoon/api/utils/medias/mappers";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import {
  enrichSearchItems,
  EXPLORE_CATEGORY_PATHS,
  fetchTmdbResults,
  injectMediaType,
  libraryEntriesForTmdbItems,
  libraryKey,
  loadAllLibraryTmdbIds,
  loadEnabledTmdbConfig,
  resolveLanguage,
  shuffle,
} from "./tmdbRouteHelpers";

// Mounted under /api/medias; requireUser guards each route directly.
export const tmdbExploreRoutes = new Hono<Env>()
  .get("/explore/:category", requireUser, async (c) => {
    const category = c.req.param("category");
    const config = EXPLORE_CATEGORY_PATHS[category];
    if (!config) {
      return badRequest(`Unknown category: ${category}`);
    }

    try {
      const tmdbConfig = await loadEnabledTmdbConfig();
      if (!tmdbConfig) {
        return badRequest("TMDB is not configured");
      }

      const q = c.req.query() as Record<string, string | undefined>;
      const language = resolveLanguage(q);
      const page = parseInt(q.page || "1", 10);

      const url = new URL(`https://api.themoviedb.org/3/${config.path}`);
      url.searchParams.set("api_key", tmdbConfig.api_key);
      url.searchParams.set("language", language);
      url.searchParams.set("page", String(page));

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        return badGateway("TMDB request failed");
      }

      const data = (await res.json()) as Record<string, unknown>;
      let items = Array.isArray(data.results) ? data.results : [];

      if (config.type) {
        items = injectMediaType(config.type)(items);
      }

      const catLibMap = await libraryEntriesForTmdbItems(
        items
          .map(mapTmdbSearchItem)
          .filter((item): item is TmdbSearchItem => Boolean(item)),
      );

      const enrichedNormalized = enrichSearchItems(items, catLibMap);

      return ok({
        items: enrichedNormalized,
        page,
        total_pages:
          typeof data.total_pages === "number" ? data.total_pages : 1,
      });
    } catch (error) {
      console.error("Error fetching explore category:", error);
      return serverError("Failed to fetch category");
    }
  })

  .get("/similar/:tmdbId", requireUser, async (c) => {
    const tmdbId = parseInt(c.req.param("tmdbId"), 10);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return badRequest("Invalid TMDB ID");
    }

    const mediaType = c.req.query("type");
    if (mediaType !== "movie" && mediaType !== "tv") {
      return badRequest("Invalid type, must be movie or tv");
    }

    const language = resolveLanguage(
      c.req.query() as Record<string, string | undefined>,
    );

    try {
      const cacheKey = `medias:recommendations:${mediaType}:${tmdbId}:${language}`;
      const cached = await getJsonCache<TmdbSearchItem[]>(cacheKey);
      if (cached) {
        return ok({ items: cached });
      }

      const tmdbConfig = await loadEnabledTmdbConfig();
      if (!tmdbConfig) {
        return badRequest("TMDB is not configured");
      }

      const url = new URL(
        `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/recommendations`,
      );
      url.searchParams.set("api_key", tmdbConfig.api_key);
      url.searchParams.set("language", language);
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      const rawResults: unknown[] = [];
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        if (Array.isArray(data.results)) rawResults.push(...data.results);
      }

      const withType = injectMediaType(mediaType)(rawResults);

      const baseItems = withType
        .map(mapTmdbSearchItem)
        .filter((item): item is TmdbSearchItem => Boolean(item))
        .slice(0, 40);

      const simLibMap = await libraryEntriesForTmdbItems(baseItems);
      const enrichedItems = enrichSearchItems(withType, simLibMap).slice(0, 40);

      await setJsonCache(cacheKey, enrichedItems, 60 * 60);
      return ok({ items: enrichedItems });
    } catch (error) {
      console.error("Error fetching similar medias:", error);
      return serverError("Failed to fetch similar medias");
    }
  });
