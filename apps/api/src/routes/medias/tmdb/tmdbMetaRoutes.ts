import { Hono } from "hono";
import { prisma } from "@rawkoon/api/db";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { badGateway, badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { toStringOrNull } from "@rawkoon/api/utils/medias/mappers";
import {
  loadTmdbConfig,
  toTmdbLanguage,
} from "@rawkoon/api/utils/medias/tmdbFetcherCore";
import { fetchMediaDetails } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";
import {
  fetchCredits,
  fetchRatings,
  fetchTrailer,
  fetchWatchProviders,
} from "@rawkoon/api/utils/medias/tmdbFetcherEndpoints";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import {
  buildDiscoverUrl,
  DISCOVER_PAGE_SIZE,
  DISCOVER_VALID_SORTS,
  enrichItemsFromRaw,
  fetchModalLibraryEpisodes,
  injectMediaType,
  loadEnabledTmdbConfig,
  parseMediaTypeAndTmdbId,
  resolveLanguage,
  TMDB_PAGE_SIZE,
} from "./tmdbRouteHelpers";

// Mounted under /api/medias; requireUser applied at the tmdb parent.
export const tmdbMetaRoutes = new Hono<Env>()
  .get("/streaming-providers", async (c) => {
    const q = c.req.query() as Record<string, string | undefined>;
    const region = await getGlobalTmdbRegion();
    const type = q.type === "tv" ? "tv" : "movie";
    const language = resolveLanguage(q);
    const cacheKey = `medias:streaming-providers:${region}:${type}:${language}`;

    const cached =
      await getJsonCache<{ id: number; name: string; logo_url: string }[]>(
        cacheKey,
      );
    if (cached) return ok({ providers: cached, region });

    const tmdbConfig = await loadEnabledTmdbConfig();
    if (!tmdbConfig) return ok({ providers: [], region });

    try {
      const url = new URL(
        `https://api.themoviedb.org/3/watch/providers/${type}`,
      );
      url.searchParams.set("api_key", tmdbConfig.api_key);
      url.searchParams.set("language", language);
      url.searchParams.set("watch_region", region);
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return ok({ providers: [] });

      const data = (await res.json()) as Record<string, unknown>;
      const LOGO_BASE = "https://image.tmdb.org/t/p/w92";

      const providers = (
        Array.isArray(data.results)
          ? (data.results as Record<string, unknown>[])
          : []
      )
        .map((p) => {
          const id = typeof p.provider_id === "number" ? p.provider_id : null;
          const name = toStringOrNull(p.provider_name);
          const logo = toStringOrNull(p.logo_path);
          if (!id || !name || !logo) return null;
          return { id, name, logo_url: `${LOGO_BASE}${logo}` };
        })
        .filter(
          (p): p is { id: number; name: string; logo_url: string } =>
            p !== null,
        );

      await setJsonCache(cacheKey, providers, 24 * 60 * 60);
      return ok({ providers, region });
    } catch {
      return ok({ providers: [], region });
    }
  })

  .get("/genres", async (c) => {
    const q = c.req.query() as Record<string, string | undefined>;
    const type = q.type;
    if (type !== "movie" && type !== "tv") {
      return badRequest("Invalid type, must be movie or tv");
    }

    try {
      const language = resolveLanguage(q);
      const cacheKey = `medias:genres:${type}:${language}`;
      const cached =
        await getJsonCache<{ id: number; name: string }[]>(cacheKey);
      if (cached) return ok({ genres: cached });

      const tmdbConfig = await loadEnabledTmdbConfig();
      if (!tmdbConfig) return badRequest("TMDB is not configured");

      const url = new URL(`https://api.themoviedb.org/3/genre/${type}/list`);
      url.searchParams.set("api_key", tmdbConfig.api_key);
      url.searchParams.set("language", language);
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return badGateway("TMDB genres request failed");

      const data = (await res.json()) as Record<string, unknown>;
      const genres = Array.isArray(data.genres)
        ? (data.genres as Record<string, unknown>[])
            .map((g) => ({
              id: typeof g.id === "number" ? g.id : 0,
              name: typeof g.name === "string" ? g.name : "",
            }))
            .filter((g) => g.id > 0 && g.name)
        : [];

      await setJsonCache(cacheKey, genres, 24 * 60 * 60);
      return ok({ genres });
    } catch (error) {
      console.error("Error fetching TMDB genres:", error);
      return serverError("Failed to fetch genres");
    }
  })

  .get("/discover", async (c) => {
    const q = c.req.query() as Record<string, string | undefined>;
    const type = q.type;
    if (type !== "movie" && type !== "tv") {
      return badRequest("Invalid type, must be movie or tv");
    }

    const providerId = q.provider_id ? parseInt(q.provider_id, 10) : null;
    const genreId = q.genre_id ? parseInt(q.genre_id, 10) : null;
    const sortBy = q.sort_by || "popularity.desc";
    const page = parseInt(q.page || "1", 10);
    const language = resolveLanguage(q);
    const region = await getGlobalTmdbRegion();
    const originalLanguage = q.original_language || null;

    if (
      !DISCOVER_VALID_SORTS.includes(
        sortBy as (typeof DISCOVER_VALID_SORTS)[number],
      )
    ) {
      return badRequest("Invalid sort_by value");
    }

    const startIdx = (page - 1) * DISCOVER_PAGE_SIZE;
    const endIdx = startIdx + DISCOVER_PAGE_SIZE - 1;
    const tmdbStartPage = Math.floor(startIdx / TMDB_PAGE_SIZE) + 1;
    const tmdbEndPage = Math.floor(endIdx / TMDB_PAGE_SIZE) + 1;

    try {
      const tmdbConfig = await loadEnabledTmdbConfig();
      if (!tmdbConfig) return badRequest("TMDB is not configured");

      const discoverOpts = {
        language,
        sortBy,
        region,
        providerId,
        genreId,
        originalLanguage,
      };

      const tmdbPageNums = Array.from(
        { length: tmdbEndPage - tmdbStartPage + 1 },
        (_, i) => tmdbStartPage + i,
      );
      const tmdbResponses = await Promise.all(
        tmdbPageNums.map((n) =>
          fetch(
            buildDiscoverUrl(tmdbConfig, type, {
              ...discoverOpts,
              tmdbPage: n,
            }),
            { headers: { Accept: "application/json" } },
          ),
        ),
      );

      if (tmdbResponses.some((r) => !r.ok))
        return badGateway("TMDB discover request failed");

      const tmdbDatas = await Promise.all(
        tmdbResponses.map((r) => r.json() as Promise<Record<string, unknown>>),
      );

      const allRaw = tmdbDatas.flatMap((d) =>
        injectMediaType(type)(Array.isArray(d.results) ? d.results : []),
      );
      const offsetWithinBatch = startIdx - (tmdbStartPage - 1) * TMDB_PAGE_SIZE;
      const rawItems = allRaw.slice(
        offsetWithinBatch,
        offsetWithinBatch + DISCOVER_PAGE_SIZE,
      );

      const totalResults =
        typeof tmdbDatas[0].total_results === "number"
          ? tmdbDatas[0].total_results
          : 0;
      const maxItems = Math.min(totalResults, 500 * TMDB_PAGE_SIZE);
      const totalPages = Math.ceil(maxItems / DISCOVER_PAGE_SIZE);

      const enrichedBrse = await enrichItemsFromRaw(rawItems);

      return ok({
        items: enrichedBrse,
        page,
        region,
        total_pages: totalPages,
        total_results: totalResults,
      });
    } catch (error) {
      console.error("Error fetching TMDB discover:", error);
      return serverError("Failed to fetch discover results");
    }
  })

  .get("/modal/:mediaType/:tmdbId", async (c) => {
    const parsed = parseMediaTypeAndTmdbId(
      c.req.param("mediaType"),
      c.req.param("tmdbId"),
    );
    if (!parsed.ok) return badRequest("Invalid media type or TMDB ID");

    const { mediaType, tmdbId } = parsed;
    const region = await getGlobalTmdbRegion();
    const language = toTmdbLanguage(c.req.query("language") || "en-US");

    const [tmdbConfig, watchlistItem] = await Promise.all([
      loadTmdbConfig(),
      prisma.watchlistItem.findUnique({
        where: {
          userId_tmdbId_mediaType: {
            userId: c.get("user").id,
            tmdbId,
            mediaType,
          },
        },
        select: { id: true },
      }),
    ]);
    if (!tmdbConfig) return badRequest("TMDB is not configured");

    const [trailer, ratings, credits, details, providers, library_episodes] =
      await Promise.all([
        fetchTrailer(tmdbConfig.api_key, mediaType, tmdbId, language),
        fetchRatings(tmdbConfig.api_key, mediaType, tmdbId, language),
        fetchCredits(tmdbConfig.api_key, mediaType, tmdbId, language),
        fetchMediaDetails(tmdbConfig.api_key, mediaType, tmdbId, language),
        fetchWatchProviders(
          tmdbConfig.api_key,
          mediaType,
          tmdbId,
          region,
          language,
        ),
        fetchModalLibraryEpisodes(mediaType, tmdbId),
      ]);

    return ok({
      watchlist_status: watchlistItem !== null,
      watchlist_id: watchlistItem?.id ?? null,
      trailer,
      ratings,
      credits,
      details,
      providers,
      library_episodes,
    });
  });
