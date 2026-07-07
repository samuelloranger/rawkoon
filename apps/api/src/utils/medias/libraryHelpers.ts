/**
 * Shared helpers for TMDB-sourced library data.
 * Used by libraryFromTmdb, libraryMediaAdmin, and the refresh scripts.
 */

import { prisma } from "@rawkoon/api/db";
import { normalizeTmdbConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";

const TMDB_BASE = "https://api.themoviedb.org/3";

export function sortTitleFromName(name: string): string {
  return name.replace(/^(the |a |an )/i, "").trim();
}

export async function getLibraryTmdbApiKey(): Promise<string | null> {
  const integration = await getIntegrationConfigRecord("tmdb");
  if (!integration?.enabled) return null;
  const cfg = normalizeTmdbConfig(integration.config);
  return cfg?.api_key ?? null;
}

export async function tmdbApiFetch<T>(
  path: string,
  apiKey: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${TMDB_BASE}/${path}`);
  url.searchParams.set("api_key", apiKey);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TMDB ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/** Full season/episode upsert for a show (matches POST /api/library show upsert). */
export async function upsertLibraryShowEpisodesFromTmdb(opts: {
  mediaId: number;
  tmdbShowId: number;
  apiKey: string;
  languageParams?: Record<string, string>;
}): Promise<void> {
  const lang = opts.languageParams ?? {
    language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
  };
  const { mediaId, tmdbShowId, apiKey } = opts;

  const details = await tmdbApiFetch<{
    seasons: Array<{ season_number: number; episode_count: number }>;
  }>(`tv/${tmdbShowId}`, apiKey, lang);

  const regularSeasons = details.seasons.filter((s) => s.season_number > 0);

  for (const s of regularSeasons) {
    const seasonData = await tmdbApiFetch<{
      episodes: Array<{
        id: number;
        episode_number: number;
        name: string;
        air_date: string | null;
      }>;
    }>(`tv/${tmdbShowId}/season/${s.season_number}`, apiKey, lang);

    await Promise.all(
      seasonData.episodes.map((ep) =>
        prisma.libraryEpisode.upsert({
          where: {
            mediaId_season_episode: {
              mediaId,
              season: s.season_number,
              episode: ep.episode_number,
            },
          },
          create: {
            mediaId,
            season: s.season_number,
            episode: ep.episode_number,
            title: ep.name || null,
            airDate: ep.air_date ? new Date(ep.air_date) : null,
            tmdbEpisodeId: ep.id,
          },
          update: {
            title: ep.name || null,
            airDate: ep.air_date ? new Date(ep.air_date) : null,
            tmdbEpisodeId: ep.id,
          },
        }),
      ),
    );
  }
}

export function resolveDownloadedStatus(
  type: string,
  tmdbStatus: string | null,
): string {
  if (type === "show" && tmdbStatus) {
    if (tmdbStatus === "Returning Series") return "returning";
    if (tmdbStatus === "In Production") return "in_production";
    if (tmdbStatus === "Planned") return "planned";
  }
  return "downloaded";
}

export function pickDigitalRelease(
  results: Array<{
    iso_3166_1: string;
    release_dates: Array<{ type: number; release_date: string }>;
  }>,
  region: string,
): Date | null {
  // Prioritise the user's region; fall back to any other country with a digital release (type 4).
  for (const country of [region, ...results.map((r) => r.iso_3166_1)]) {
    const entry = results.find((r) => r.iso_3166_1 === country);
    const digital = entry?.release_dates.find(
      (d) => d.type === 4 && d.release_date,
    );
    if (digital) {
      const dt = new Date(digital.release_date);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
  }
  return null;
}
