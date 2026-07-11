import { prisma } from "@rawkoon/api/db";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeTmdbConfig } from "@rawkoon/api/utils/integrations/normalizers";
import {
  type TmdbSearchItem,
  mapTmdbSearchItem,
} from "@rawkoon/api/utils/medias/mappers";
import { toTmdbLanguage } from "@rawkoon/api/utils/medias/tmdbFetcherCore";

export type TmdbConfig = { api_key: string };

export async function loadEnabledTmdbConfig(): Promise<TmdbConfig | null> {
  const tmdbIntegration = await getIntegrationConfigRecord("tmdb");
  return tmdbIntegration?.enabled
    ? normalizeTmdbConfig(tmdbIntegration.config)
    : null;
}

export function resolveLanguage(
  query: Record<string, string | undefined>,
  fallback = "en-US",
): string {
  return toTmdbLanguage(query.language || fallback);
}

export function injectMediaType(type: "movie" | "tv") {
  return (items: unknown[]) =>
    items.map((item) =>
      typeof item === "object" && item !== null
        ? { ...item, media_type: type }
        : item,
    );
}

export async function fetchTmdbResults(
  apiKey: string,
  path: string,
  language: string,
  extra?: Record<string, string>,
): Promise<unknown[]> {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", language);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Record<string, unknown>;
  return Array.isArray(data.results) ? data.results : [];
}

export async function libraryIdMapForTmdbIds(
  tmdbIds: number[],
): Promise<Map<number, number>> {
  if (tmdbIds.length === 0) return new Map();
  const entries = await prisma.libraryMedia.findMany({
    where: { tmdbId: { in: tmdbIds } },
    select: { tmdbId: true, id: true },
  });
  return new Map(entries.map((e) => [e.tmdbId, e.id]));
}

export function enrichSearchItems(
  items: unknown[],
  libraryIdByTmdbId: Map<number, number | null | undefined>,
): TmdbSearchItem[] {
  return items
    .map(mapTmdbSearchItem)
    .filter((item): item is TmdbSearchItem => Boolean(item))
    .map((item) => {
      const libId = libraryIdByTmdbId.get(item.tmdb_id) ?? null;
      return {
        ...item,
        service: "prowlarr" as const,
        already_exists: libId != null,
        can_add: true,
        source_id: null,
        library_id: libId,
      };
    });
}

export async function enrichItemsFromRaw(
  items: unknown[],
  libraryIdByTmdbId?: Map<number, number | null | undefined>,
): Promise<TmdbSearchItem[]> {
  const baseItems = items
    .map(mapTmdbSearchItem)
    .filter((item): item is TmdbSearchItem => Boolean(item));

  const libMap =
    libraryIdByTmdbId ??
    (await libraryIdMapForTmdbIds(baseItems.map((i) => i.tmdb_id)));

  return enrichSearchItems(items, libMap);
}

export async function loadAllLibraryTmdbIds(): Promise<{
  libraryIdByTmdbId: Map<number, number>;
  allTmdbIds: Set<number>;
  movieTmdbIds: number[];
  showTmdbIds: number[];
}> {
  const libraryAllEntries = await prisma.libraryMedia.findMany({
    select: { tmdbId: true, id: true, type: true },
  });

  const libraryIdByTmdbId = new Map(
    libraryAllEntries.map((e) => [e.tmdbId, e.id]),
  );

  return {
    libraryIdByTmdbId,
    allTmdbIds: new Set(libraryAllEntries.map((e) => e.tmdbId)),
    movieTmdbIds: libraryAllEntries
      .filter((e) => e.type === "movie")
      .map((e) => e.tmdbId),
    showTmdbIds: libraryAllEntries
      .filter((e) => e.type === "show")
      .map((e) => e.tmdbId),
  };
}

export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const EXPLORE_CATEGORY_PATHS: Record<
  string,
  { path: string; type?: "movie" | "tv" }
> = {
  trending: { path: "trending/all/day" },
  popular_movies: { path: "movie/popular", type: "movie" },
  popular_shows: { path: "tv/popular", type: "tv" },
  upcoming_movies: { path: "movie/upcoming", type: "movie" },
  now_playing: { path: "movie/now_playing", type: "movie" },
  airing_today: { path: "tv/airing_today", type: "tv" },
  on_the_air: { path: "tv/on_the_air", type: "tv" },
  top_rated_movies: { path: "movie/top_rated", type: "movie" },
  top_rated_shows: { path: "tv/top_rated", type: "tv" },
};

export const DISCOVER_VALID_SORTS = [
  "popularity.desc",
  "popularity.asc",
  "vote_average.desc",
  "vote_average.asc",
  "primary_release_date.desc",
  "first_air_date.desc",
  "revenue.desc",
] as const;

export const DISCOVER_PAGE_SIZE = 48;
export const TMDB_PAGE_SIZE = 20;

export function buildDiscoverUrl(
  tmdbConfig: TmdbConfig,
  type: "movie" | "tv",
  opts: {
    language: string;
    sortBy: string;
    tmdbPage: number;
    region: string;
    providerId: number | null;
    genreId: number | null;
    originalLanguage: string | null;
  },
): string {
  const url = new URL(`https://api.themoviedb.org/3/discover/${type}`);
  url.searchParams.set("api_key", tmdbConfig.api_key);
  url.searchParams.set("language", opts.language);
  url.searchParams.set("sort_by", opts.sortBy);
  url.searchParams.set("page", String(opts.tmdbPage));
  url.searchParams.set("include_adult", "false");
  if (opts.providerId) {
    url.searchParams.set("with_watch_providers", String(opts.providerId));
    url.searchParams.set("watch_region", opts.region);
  }
  if (opts.genreId) url.searchParams.set("with_genres", String(opts.genreId));
  if (opts.originalLanguage) {
    url.searchParams.set("with_original_language", opts.originalLanguage);
  }
  if (opts.sortBy.startsWith("vote_average")) {
    url.searchParams.set("vote_count.gte", "100");
  }
  if (opts.sortBy === "primary_release_date.desc") {
    const today = new Date().toISOString().slice(0, 10);
    url.searchParams.set("primary_release_date.lte", today);
    url.searchParams.set("vote_count.gte", "30");
  }
  if (opts.sortBy === "first_air_date.desc") {
    const today = new Date().toISOString().slice(0, 10);
    url.searchParams.set("first_air_date.lte", today);
    url.searchParams.set("vote_count.gte", "10");
  }
  return url.toString();
}

export function parseMediaTypeAndTmdbId(
  mediaType: string,
  tmdbIdStr: string,
): { ok: true; mediaType: "movie" | "tv"; tmdbId: number } | { ok: false } {
  if (mediaType !== "movie" && mediaType !== "tv") return { ok: false };
  const tmdbId = parseInt(tmdbIdStr, 10);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return { ok: false };
  return { ok: true, mediaType, tmdbId };
}

export async function fetchModalLibraryEpisodes(
  mediaType: "movie" | "tv",
  tmdbId: number,
) {
  if (mediaType !== "tv") return null;
  const show = await prisma.libraryMedia.findFirst({
    where: { tmdbId, type: "show" },
    select: {
      episodes: {
        where: { status: "downloaded" },
        select: { season: true, episode: true },
      },
    },
  });
  if (!show) return { in_library: false, downloaded: [] };
  return {
    in_library: true,
    downloaded: show.episodes.map((e) => ({
      season_number: e.season,
      episode_number: e.episode,
    })),
  };
}

export const EXPLORE_BASE_CACHE_TTL = 15 * 60;

export function exploreBaseCacheKey(language: string, region: string): string {
  return `medias:explore:base:${language}:${region}`;
}

export interface ExploreBaseSections {
  trending: unknown[];
  popular_movies: unknown[];
  popular_shows: unknown[];
  upcoming_movies: unknown[];
  now_playing: unknown[];
  airing_today: unknown[];
  on_the_air: unknown[];
  top_rated_movies: unknown[];
  top_rated_shows: unknown[];
}

/**
 * Redis get-or-fetch for the raw TMDB Explore sections. The cached value is the
 * external TMDB data only — never the enriched response — so callers must apply
 * the current library membership map after this returns.
 */
export async function getExploreBaseSections(opts: {
  cacheKey: string;
  ttlSeconds: number;
  skipCache: boolean;
  getCache: <T>(key: string) => Promise<T | null>;
  setCache: <T>(key: string, value: T, ttl: number) => Promise<void>;
  fetchSections: () => Promise<ExploreBaseSections>;
}): Promise<{ sections: ExploreBaseSections; cacheHit: boolean }> {
  if (!opts.skipCache) {
    const cached = await opts.getCache<ExploreBaseSections>(opts.cacheKey);
    if (cached) return { sections: cached, cacheHit: true };
  }
  const sections = await opts.fetchSections();
  await opts.setCache(opts.cacheKey, sections, opts.ttlSeconds);
  return { sections, cacheHit: false };
}
