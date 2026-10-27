import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { toRecord, toStringOrNull } from "@rawkoon/shared/utils";
import type { DashboardUpcomingItem } from "@rawkoon/api/types/dashboardUpcoming";
import { normalizeSonarrConfig } from "@rawkoon/api/utils/integrations/normalizers";

const TMDB_WEB_BASE_URL = "https://www.themoviedb.org";

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
