import { deleteCache } from "@rawkoon/api/services/cache";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { TMDB_LANGUAGES } from "@rawkoon/api/utils/medias/tmdbFetcherCore";
import { toRecord, toStringOrNull } from "@rawkoon/shared/utils";
import type {
  ArrIntegrationStatus,
  DashboardUpcomingItem,
  DashboardUpcomingProvider,
} from "@rawkoon/api/types/dashboardUpcoming";
import {
  fetchSonarrUpcoming,
  mergeTmdbTvWithSonarrCalendar,
} from "@rawkoon/api/utils/dashboard/sonarrUpcoming";

export { fetchSonarrUpcoming, mergeTmdbTvWithSonarrCalendar };

const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w342";
const TMDB_BACKDROP_BASE_URL = "https://image.tmdb.org/t/p/w780";
const TMDB_PROVIDER_LOGO_BASE_URL = "https://image.tmdb.org/t/p/w92";
const TMDB_WEB_BASE_URL = "https://www.themoviedb.org";

export const TMDB_UPCOMING_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const TMDB_UPCOMING_CACHE_KEY = "dashboard:tmdb:upcoming:v8";
export const DEFAULT_UPCOMING_LANGUAGE = "en-US";

/** The default language keeps the original key, which the cron worker and invalidators use. */
export const upcomingCacheKey = (region: string, language: string): string =>
  language === DEFAULT_UPCOMING_LANGUAGE
    ? `${TMDB_UPCOMING_CACHE_KEY}:${region}`
    : `${TMDB_UPCOMING_CACHE_KEY}:${region}:${language}`;

/** Drops every language's cached list, so a library change shows in all of them. */
export const invalidateUpcomingCache = async (
  region: string,
): Promise<void> => {
  await Promise.all(
    TMDB_LANGUAGES.map((language) =>
      deleteCache(upcomingCacheKey(region, language)),
    ),
  );
};

export const getArrIntegrationStatus =
  async (): Promise<ArrIntegrationStatus> => {
    const [radarrIntegration, sonarrIntegration] = await Promise.all([
      getIntegrationConfigRecord("radarr"),
      getIntegrationConfigRecord("sonarr"),
    ]);

    return {
      radarr_enabled: Boolean(radarrIntegration?.enabled),
      sonarr_enabled: Boolean(sonarrIntegration?.enabled),
    };
  };

export const toIsoDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Shared date window for TMDB discover (worker + dashboard fallback).
 * @param monthsAhead - Number of months ahead to include (3, 6, 12, or 24). Default 12.
 * @returns ISO date strings for today and end of window for TMDB queries.
 */
export const getTmdbUpcomingDateWindowIso = (
  monthsAhead: number = 12,
): {
  todayIso: string;
  endDateIso: string;
} => {
  const today = new Date();
  const todayIso = toIsoDate(today);
  const endDate = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth() + monthsAhead,
      today.getUTCDate(),
    ),
  );
  const endDateIso = toIsoDate(endDate);
  return { todayIso, endDateIso };
};

const mapTmdbItem = (
  rawItem: unknown,
  mediaType: "movie" | "tv",
): DashboardUpcomingItem | null => {
  const item = toRecord(rawItem);
  if (!item) return null;

  const numericId =
    typeof item.id === "number" && Number.isFinite(item.id)
      ? Math.trunc(item.id)
      : null;
  if (!numericId) return null;

  const title = toStringOrNull(item.title) || toStringOrNull(item.name);
  if (!title) return null;

  const releaseDate =
    toStringOrNull(item.release_date) ||
    toStringOrNull(item.first_air_date) ||
    toStringOrNull(item.air_date);
  const posterPath = toStringOrNull(item.poster_path);
  const backdropPath = toStringOrNull(item.backdrop_path);
  const overview = toStringOrNull(item.overview);
  const popularity =
    typeof item.popularity === "number" && Number.isFinite(item.popularity)
      ? item.popularity
      : 0;
  const voteAverage =
    typeof item.vote_average === "number" &&
    Number.isFinite(item.vote_average) &&
    item.vote_average > 0
      ? item.vote_average
      : null;

  return {
    id: `${mediaType}-${numericId}`,
    title,
    media_type: mediaType,
    release_date: releaseDate,
    poster_url: posterPath ? `${TMDB_IMAGE_BASE_URL}${posterPath}` : null,
    backdrop_url: backdropPath
      ? `${TMDB_BACKDROP_BASE_URL}${backdropPath}`
      : null,
    overview,
    tmdb_url: `${TMDB_WEB_BASE_URL}/${mediaType}/${numericId}`,
    providers: [],
    library_id: null,
    season_number: null,
    episode_number: null,
    vote_average: voteAverage,
    popularity,
  };
};

export const parseTmdbNumericId = (itemId: string): number | null => {
  const [source, numericPart] = itemId.split("-", 2);
  if (source !== "movie" && source !== "tv") return null;
  const numericId = numericPart ? parseInt(numericPart, 10) : Number.NaN;
  return Number.isFinite(numericId) ? numericId : null;
};

const fetchTmdbDiscoverPage = async (
  mediaType: "movie" | "tv",
  page: number,
  tmdbApiKey: string,
  fromDateIso: string | null,
  toDateIso: string,
  region: string,
  languages: string = "en,fr",
  tmdbLanguage: string = DEFAULT_UPCOMING_LANGUAGE,
): Promise<{ items: DashboardUpcomingItem[]; totalPages: number } | null> => {
  const endpoint = mediaType === "movie" ? "discover/movie" : "discover/tv";
  const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
  url.searchParams.set("api_key", tmdbApiKey);
  url.searchParams.set("language", tmdbLanguage);
  url.searchParams.set("page", String(page));

  const languageFilter = languages.split(",").join("|");

  if (mediaType === "movie") {
    // Prioritize mainstream/popular titles and avoid low-signal niche results.
    url.searchParams.set("sort_by", "popularity.desc");
    if (fromDateIso) url.searchParams.set("release_date.gte", fromDateIso);
    url.searchParams.set("release_date.lte", toDateIso);
    url.searchParams.set("with_release_type", "4|5");
    url.searchParams.set("with_original_language", languageFilter);
    url.searchParams.set("include_adult", "false");
    url.searchParams.set("include_video", "false");
  } else {
    url.searchParams.set("sort_by", "popularity.desc");
    if (fromDateIso) url.searchParams.set("first_air_date.gte", fromDateIso);
    url.searchParams.set("first_air_date.lte", toDateIso);
    url.searchParams.set("include_null_first_air_dates", "false");
    url.searchParams.set("with_original_language", languageFilter);
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as Record<string, unknown>;
  const results = Array.isArray(data.results) ? data.results : [];
  const totalPagesRaw =
    typeof data.total_pages === "number" ? Math.trunc(data.total_pages) : 1;
  const totalPages = Math.max(
    1,
    Number.isFinite(totalPagesRaw) ? totalPagesRaw : 1,
  );

  const items = results
    .map((item) => mapTmdbItem(item, mediaType))
    .filter((item): item is DashboardUpcomingItem => !!item);

  return { items, totalPages };
};

export const collectTmdbUpcoming = async (
  mediaType: "movie" | "tv",
  requiredCount: number,
  tmdbApiKey: string,
  fromDateIso: string | null,
  toDateIso: string,
  region: string,
  languages: string = "en,fr",
  tmdbLanguage: string = DEFAULT_UPCOMING_LANGUAGE,
): Promise<{ items: DashboardUpcomingItem[]; hasMore: boolean } | null> => {
  const items: DashboardUpcomingItem[] = [];
  let page = 1;
  let totalPages = 1;

  while (items.length < requiredCount && page <= totalPages) {
    const response = await fetchTmdbDiscoverPage(
      mediaType,
      page,
      tmdbApiKey,
      fromDateIso,
      toDateIso,
      region,
      languages,
      tmdbLanguage,
    );
    if (!response) return null;
    items.push(...response.items);
    totalPages = response.totalPages;
    page += 1;
  }

  return { items, hasMore: page <= totalPages };
};

export const fetchTmdbProviders = async (
  mediaType: "movie" | "tv",
  tmdbId: number,
  tmdbApiKey: string,
  region: string,
): Promise<DashboardUpcomingProvider[]> => {
  try {
    const providersUrl = new URL(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers`,
    );
    providersUrl.searchParams.set("api_key", tmdbApiKey);
    const response = await fetch(providersUrl.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];

    const data = (await response.json()) as Record<string, unknown>;
    const results = toRecord(data.results);
    const regionData = toRecord(results?.[region]);
    if (!regionData) return [];

    const categoryOrder = ["flatrate", "free", "ads", "rent", "buy"] as const;
    const selected: DashboardUpcomingProvider[] = [];
    const seen = new Set<number>();

    for (const category of categoryOrder) {
      const entries = Array.isArray(regionData[category])
        ? regionData[category]
        : [];
      for (const rawProvider of entries) {
        const provider = toRecord(rawProvider);
        if (!provider) continue;

        const providerId =
          typeof provider.provider_id === "number"
            ? Math.trunc(provider.provider_id)
            : null;
        const providerName = toStringOrNull(provider.provider_name);
        const logoPath = toStringOrNull(provider.logo_path);
        if (!providerId || !providerName || !logoPath || seen.has(providerId))
          continue;

        selected.push({
          id: providerId,
          name: providerName,
          logo_url: `${TMDB_PROVIDER_LOGO_BASE_URL}${logoPath}`,
        });
        seen.add(providerId);

        if (selected.length >= 4) return selected;
      }
    }

    return selected;
  } catch {
    return [];
  }
};

/** Day of the first release of `type` in one country entry; malformed entries yield null. */
const releaseDayOfType = (entry: unknown, type: number): string | null => {
  const dates = toRecord(entry)?.release_dates;
  if (!Array.isArray(dates)) return null;
  for (const raw of dates) {
    const rd = toRecord(raw);
    const day = rd?.release_date;
    if (rd?.type === type && typeof day === "string" && day) {
      return day.substring(0, 10);
    }
  }
  return null;
};

/**
 * The region's digital, then physical, release day; else the first digital
 * release anywhere, the same fallback the library uses for its own date.
 */
export const pickUpcomingMovieDay = (
  results: unknown[],
  region: string,
): string | null => {
  const regionEntry = results.find(
    (r) => toStringOrNull(toRecord(r)?.iso_3166_1) === region,
  );
  return (
    releaseDayOfType(regionEntry, 4) ??
    releaseDayOfType(regionEntry, 5) ??
    results.map((r) => releaseDayOfType(r, 4)).find((day) => day != null) ??
    null
  );
};

/** A movie's home release day (YYYY-MM-DD) from TMDB, or null when unknown. */
export const fetchMovieReleaseDates = async (
  tmdbId: number,
  tmdbApiKey: string,
  region: string,
): Promise<string | null> => {
  try {
    const url = new URL(
      `https://api.themoviedb.org/3/movie/${tmdbId}/release_dates`,
    );
    url.searchParams.set("api_key", tmdbApiKey);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const data = toRecord(await response.json());
    return pickUpcomingMovieDay(
      Array.isArray(data?.results) ? data.results : [],
      region,
    );
  } catch {
    return null;
  }
};
