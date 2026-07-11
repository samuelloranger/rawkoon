import { Elysia, t } from "elysia";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { badGateway, badRequest, serverError } from "@rawkoon/api/errors";
import {
  type TmdbSearchItem,
  mapTmdbSearchItem,
} from "@rawkoon/api/utils/medias/mappers";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import {
  enrichSearchItems,
  EXPLORE_BASE_CACHE_TTL,
  EXPLORE_CATEGORY_PATHS,
  exploreBaseCacheKey,
  fetchTmdbResults,
  getExploreBaseSections,
  injectMediaType,
  libraryIdMapForTmdbIds,
  loadAllLibraryTmdbIds,
  loadEnabledTmdbConfig,
  resolveLanguage,
  shuffle,
} from "./tmdbRouteHelpers";

export const tmdbExploreRoutes = new Elysia()
  .use(requireUser)
  .get("/explore", async ({ user: _user, set, query }) => {
    try {
      const tmdbConfig = await loadEnabledTmdbConfig();
      if (!tmdbConfig) {
        return badRequest(set, "TMDB is not configured");
      }

      const q = query as Record<string, string | undefined>;
      const language = resolveLanguage(q);
      const region = await getGlobalTmdbRegion();
      const skipCache = q.skipCache === "true";

      const fetchTmdb = (path: string, extra?: Record<string, string>) =>
        fetchTmdbResults(tmdbConfig.api_key, path, language, extra);

      const cacheKey = exploreBaseCacheKey(language, region);
      const { sections } = await getExploreBaseSections({
        cacheKey,
        ttlSeconds: EXPLORE_BASE_CACHE_TTL,
        skipCache,
        getCache: getJsonCache,
        setCache: setJsonCache,
        fetchSections: async () => {
          const [
            trending,
            popularMovies,
            popularShows,
            upcomingMovies,
            nowPlaying,
            airingToday,
            onTheAir,
            topRatedMovies,
            topRatedShows,
          ] = await Promise.all([
            fetchTmdb("trending/all/day"),
            fetchTmdb("movie/popular").then(injectMediaType("movie")),
            fetchTmdb("tv/popular").then(injectMediaType("tv")),
            fetchTmdb("movie/upcoming").then(injectMediaType("movie")),
            fetchTmdb("movie/now_playing").then(injectMediaType("movie")),
            fetchTmdb("tv/airing_today").then(injectMediaType("tv")),
            fetchTmdb("tv/on_the_air").then(injectMediaType("tv")),
            fetchTmdb("movie/top_rated").then(injectMediaType("movie")),
            fetchTmdb("discover/tv", {
              sort_by: "vote_average.desc",
              with_origin_country: region,
              "vote_count.gte": "200",
              without_genres: "16",
            }).then(injectMediaType("tv")),
          ]);
          return {
            trending,
            popular_movies: popularMovies,
            popular_shows: popularShows,
            upcoming_movies: upcomingMovies,
            now_playing: nowPlaying,
            airing_today: airingToday,
            on_the_air: onTheAir,
            top_rated_movies: topRatedMovies,
            top_rated_shows: topRatedShows,
          };
        },
      });

      const { libraryIdByTmdbId, allTmdbIds, movieTmdbIds, showTmdbIds } =
        await loadAllLibraryTmdbIds();

      const normalize = (items: unknown[]) =>
        enrichSearchItems(items, libraryIdByTmdbId);

      const recommendationsCacheKey = `medias:explore:recommendations:${language}`;

      let recommended: TmdbSearchItem[] = [];
      if (!skipCache) {
        const cachedRecommendations = await getJsonCache<TmdbSearchItem[]>(
          recommendationsCacheKey,
        );
        if (cachedRecommendations) {
          recommended = cachedRecommendations;
        }
      }

      if (!recommended.length) {
        const sampleMovieIds = shuffle(movieTmdbIds).slice(0, 5);
        const sampleShowIds = shuffle(showTmdbIds).slice(0, 4);

        const recResults = await Promise.all([
          ...sampleMovieIds.map((id) =>
            fetchTmdb(`movie/${id}/recommendations`)
              .then(injectMediaType("movie"))
              .catch(() => [] as unknown[]),
          ),
          ...sampleShowIds.map((id) =>
            fetchTmdb(`tv/${id}/recommendations`)
              .then(injectMediaType("tv"))
              .catch(() => [] as unknown[]),
          ),
        ]);

        const seen = new Set<number>();

        recommended = normalize(recResults.flat())
          .filter((item) => {
            if (seen.has(item.tmdb_id) || allTmdbIds.has(item.tmdb_id))
              return false;
            seen.add(item.tmdb_id);
            return true;
          })
          .slice(0, 20);

        if (recommended.length > 0) {
          await setJsonCache(recommendationsCacheKey, recommended, 60 * 60);
        }
      }

      return {
        trending: normalize(sections.trending),
        popular_movies: normalize(sections.popular_movies),
        popular_shows: normalize(sections.popular_shows),
        upcoming_movies: normalize(sections.upcoming_movies),
        now_playing: normalize(sections.now_playing),
        airing_today: normalize(sections.airing_today),
        on_the_air: normalize(sections.on_the_air),
        top_rated_movies: normalize(sections.top_rated_movies),
        top_rated_shows: normalize(sections.top_rated_shows),
        recommended,
      };
    } catch (error) {
      console.error("Error fetching TMDB explore:", error);
      return serverError(set, "Failed to fetch TMDB explore");
    }
  })

  .get("/explore/:category", async ({ user: _user, set, params, query }) => {
    const category = (params as Record<string, string>).category;
    const config = EXPLORE_CATEGORY_PATHS[category];
    if (!config) {
      return badRequest(set, `Unknown category: ${category}`);
    }

    try {
      const tmdbConfig = await loadEnabledTmdbConfig();
      if (!tmdbConfig) {
        return badRequest(set, "TMDB is not configured");
      }

      const q = query as Record<string, string | undefined>;
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
        return badGateway(set, "TMDB request failed");
      }

      const data = (await res.json()) as Record<string, unknown>;
      let items = Array.isArray(data.results) ? data.results : [];

      if (config.type) {
        items = injectMediaType(config.type)(items);
      }

      const catTmdbIds = items
        .map(mapTmdbSearchItem)
        .filter((item): item is TmdbSearchItem => Boolean(item))
        .map((i) => i.tmdb_id);
      const catLibMap = await libraryIdMapForTmdbIds(catTmdbIds);

      const enrichedNormalized = enrichSearchItems(items, catLibMap);

      return {
        items: enrichedNormalized,
        page,
        total_pages:
          typeof data.total_pages === "number" ? data.total_pages : 1,
      };
    } catch (error) {
      console.error("Error fetching explore category:", error);
      return serverError(set, "Failed to fetch category");
    }
  })

  .get(
    "/similar/:tmdbId",
    async ({ user: _user, set, params, query: queryParams }) => {
      const tmdbId = parseInt(params.tmdbId, 10);
      if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
        return badRequest(set, "Invalid TMDB ID");
      }

      const typedQuery = queryParams as Record<string, string | undefined>;
      const mediaType = typedQuery.type;
      if (mediaType !== "movie" && mediaType !== "tv") {
        return badRequest(set, "Invalid type, must be movie or tv");
      }

      const language = resolveLanguage(typedQuery);

      try {
        const cacheKey = `medias:recommendations:${mediaType}:${tmdbId}:${language}`;
        const cached = await getJsonCache<TmdbSearchItem[]>(cacheKey);
        if (cached) {
          return { items: cached };
        }

        const tmdbConfig = await loadEnabledTmdbConfig();
        if (!tmdbConfig) {
          return badRequest(set, "TMDB is not configured");
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

        const simLibMap = await libraryIdMapForTmdbIds(
          baseItems.map((i) => i.tmdb_id),
        );
        const enrichedItems = enrichSearchItems(withType, simLibMap).slice(
          0,
          40,
        );

        await setJsonCache(cacheKey, enrichedItems, 60 * 60);
        return { items: enrichedItems };
      } catch (error) {
        console.error("Error fetching similar medias:", error);
        return serverError(set, "Failed to fetch similar medias");
      }
    },
    {
      params: t.Object({ tmdbId: t.String() }),
    },
  );
