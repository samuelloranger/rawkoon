import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { toRecord, toStringOrNull } from "@rawkoon/shared/utils";
import type {
  ArrIntegrationStatus,
  DashboardUpcomingItem,
  DashboardUpcomingProvider,
} from "@rawkoon/api/types/dashboardUpcoming";
import { normalizeSonarrConfig } from "@rawkoon/api/utils/integrations/normalizers";

const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w342";
const TMDB_BACKDROP_BASE_URL = "https://image.tmdb.org/t/p/w780";
const TMDB_PROVIDER_LOGO_BASE_URL = "https://image.tmdb.org/t/p/w92";
const TMDB_WEB_BASE_URL = "https://www.themoviedb.org";

export const TMDB_UPCOMING_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const TMDB_UPCOMING_CACHE_KEY = "dashboard:tmdb:upcoming:v8";

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

const buildTvUpcomingId = (
  tmdbId: number | null,
  seriesId: number,
  airDate: string,
  episode?: { season: number; episode: number } | null,
): string => {
  const prefix = tmdbId ? `tv-${tmdbId}` : `sonarr-${seriesId}`;
  if (!episode) return `${prefix}-${airDate}`;
  return `${prefix}-${airDate}-s${episode.season}e${episode.episode}`;
};

const fetchTmdbDiscoverPage = async (
  mediaType: "movie" | "tv",
  page: number,
  tmdbApiKey: string,
  fromDateIso: string | null,
  toDateIso: string,
  region: string,
  languages: string = "en,fr",
): Promise<{ items: DashboardUpcomingItem[]; totalPages: number } | null> => {
  const endpoint = mediaType === "movie" ? "discover/movie" : "discover/tv";
  const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
  url.searchParams.set("api_key", tmdbApiKey);
  url.searchParams.set("language", "en-US");
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

/**
 * Fetch upcoming episodes from Sonarr's calendar endpoint.
 * Returns one entry per series (the earliest upcoming episode), formatted as
 * DashboardUpcomingItem so it can be merged with TMDB results.
 */
export const fetchSonarrUpcoming = async (
  fromDateIso: string,
  toDateIso: string,
): Promise<DashboardUpcomingItem[]> => {
  try {
    const sonarrIntegration = await getIntegrationConfigRecord("sonarr");
    if (!sonarrIntegration?.enabled) return [];

    const config = normalizeSonarrConfig(sonarrIntegration.config);
    if (!config) return [];

    const url = new URL("/api/v3/calendar", config.website_url);
    url.searchParams.set("start", fromDateIso);
    url.searchParams.set("end", toDateIso);
    url.searchParams.set("includeSeries", "true");
    url.searchParams.set("includeEpisodeImages", "false");

    const response = await fetch(url.toString(), {
      headers: { "X-Api-Key": config.api_key, Accept: "application/json" },
    });
    if (!response.ok) return [];

    const episodes = (await response.json()) as unknown[];
    if (!Array.isArray(episodes)) return [];

    // Group episodes by series/date. Show every upcoming date, but only expose
    // S/E numbers when exactly one episode airs on that date.
    const seriesMap = new Map<
      string,
      {
        item: DashboardUpcomingItem;
        episodeCountOnDate: number;
      }
    >();

    for (const rawEpisode of episodes) {
      const ep = toRecord(rawEpisode);
      if (!ep) continue;

      const series = toRecord(ep.series);
      if (!series) continue;

      const seriesId =
        typeof series.id === "number" ? Math.trunc(series.id) : null;
      if (!seriesId) continue;

      const tmdbId =
        typeof series.tmdbId === "number" ? Math.trunc(series.tmdbId) : null;
      const title = toStringOrNull(series.title);
      if (!title) continue;

      const airDate = toStringOrNull(ep.airDate); // YYYY-MM-DD
      if (!airDate) continue;
      const seasonNumber =
        typeof ep.seasonNumber === "number" && Number.isFinite(ep.seasonNumber)
          ? Math.trunc(ep.seasonNumber)
          : null;
      const episodeNumber =
        typeof ep.episodeNumber === "number" &&
        Number.isFinite(ep.episodeNumber)
          ? Math.trunc(ep.episodeNumber)
          : null;

      const groupKey = `${seriesId}:${airDate}`;
      const existing = seriesMap.get(groupKey);
      if (existing) {
        existing.episodeCountOnDate += 1;
        existing.item.id = buildTvUpcomingId(tmdbId, seriesId, airDate, null);
        existing.item.season_number = null;
        existing.item.episode_number = null;
        continue;
      }

      const images = Array.isArray(series.images) ? series.images : [];
      let posterUrl: string | null = null;
      let backdropUrl: string | null = null;
      for (const img of images) {
        const imgRecord = toRecord(img);
        if (!imgRecord) continue;
        const coverType = toStringOrNull(imgRecord.coverType);
        const remoteUrl = toStringOrNull(imgRecord.remoteUrl);
        if (!remoteUrl) continue;
        if (coverType === "poster" && !posterUrl) posterUrl = remoteUrl;
        if (coverType === "fanart" && !backdropUrl) backdropUrl = remoteUrl;
      }

      const overview = toStringOrNull(series.overview);
      const voteAverage =
        typeof series.ratings === "object" && series.ratings !== null
          ? (() => {
              const r = toRecord(series.ratings);
              const v = r && typeof r.value === "number" ? r.value : null;
              // Sonarr uses a 0–10 scale
              return v && v > 0 ? Math.round(v * 10) / 10 : null;
            })()
          : null;

      seriesMap.set(groupKey, {
        item: {
          id: buildTvUpcomingId(
            tmdbId,
            seriesId,
            airDate,
            seasonNumber != null && episodeNumber != null
              ? { season: seasonNumber, episode: episodeNumber }
              : null,
          ),
          title,
          media_type: "tv",
          release_date: airDate,
          poster_url: posterUrl,
          backdrop_url: backdropUrl,
          overview,
          tmdb_url: tmdbId ? `${TMDB_WEB_BASE_URL}/tv/${tmdbId}` : "",
          providers: [],
          library_id: null,
          season_number: seasonNumber,
          episode_number: episodeNumber,
          vote_average: voteAverage,
        },
        episodeCountOnDate: 1,
      });
    }

    return Array.from(seriesMap.values(), ({ item }) => item);
  } catch (error) {
    console.error("[upcoming] Failed to fetch Sonarr calendar:", error);
    return [];
  }
};

/**
 * Merge TMDB discover TV rows with Sonarr calendar rows.
 * For the same `tv-{tmdbId}`, Sonarr wins: TMDB uses `first_air_date` on discover results,
 * which is wrong for continuing series (premiere years ago). Sonarr calendar has the real
 * next episode air date for monitored shows, so we must not drop those as "duplicates".
 */
export function mergeTmdbTvWithSonarrCalendar(
  tmdbTv: DashboardUpcomingItem[],
  sonarr: DashboardUpcomingItem[],
): DashboardUpcomingItem[] {
  const byId = new Map<string, DashboardUpcomingItem>();
  for (const item of tmdbTv) {
    byId.set(item.id, item);
  }
  for (const item of sonarr) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

/**
 * Fetch the digital (type 4) or physical (type 5) release date for a movie
 * in the requested region from TMDB's /movie/{id}/release_dates endpoint.
 * Returns the ISO date string (YYYY-MM-DD) or null if not found.
 */
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

    const data = (await response.json()) as Record<string, unknown>;
    const results = Array.isArray(data.results) ? data.results : [];

    const regionEntry = results.find((entry: unknown) => {
      const e = toRecord(entry);
      return e && toStringOrNull(e.iso_3166_1) === region;
    });
    if (!regionEntry) return null;

    const regionRecord = toRecord(regionEntry);
    const releaseDates = Array.isArray(regionRecord?.release_dates)
      ? regionRecord.release_dates
      : [];

    let digitalDate: string | null = null;
    let physicalDate: string | null = null;

    for (const rd of releaseDates) {
      const rdRecord = toRecord(rd);
      if (!rdRecord) continue;
      const type = typeof rdRecord.type === "number" ? rdRecord.type : null;
      const dateStr = toStringOrNull(rdRecord.release_date);
      if (!dateStr) continue;

      const isoDate = dateStr.substring(0, 10);
      if (type === 4 && !digitalDate) digitalDate = isoDate;
      if (type === 5 && !physicalDate) physicalDate = isoDate;
    }

    return digitalDate || physicalDate || null;
  } catch {
    return null;
  }
};
