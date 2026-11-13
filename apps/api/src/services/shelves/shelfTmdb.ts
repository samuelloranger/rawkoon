import type { ShelfMediaType } from "@rawkoon/shared/types";
import { getLibraryTmdbApiKey } from "@rawkoon/api/utils/medias/libraryHelpers";
import { makeTmdbFetch } from "@rawkoon/api/utils/medias/tmdbFetcherCore";

export const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w342";
export const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

// Facts and seed results are always en-US so a rule or a seed resolves the same
// way for every account, whatever the UI language.
const FACTS_LANGUAGE = "en-US";

export interface ShelfTmdbTitle {
  tmdbId: number;
  type: ShelfMediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
}

export function posterUrlOf(path: string | null): string | null {
  return path ? `${TMDB_POSTER_BASE}${path}` : null;
}

const yearOf = (date: unknown) => {
  if (typeof date !== "string" || date.length < 4) return null;
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
};

export const tmdbType = (type: ShelfMediaType) =>
  type === "movie" ? "movie" : "tv";

function parseTitle(
  raw: Record<string, unknown>,
  type: ShelfMediaType,
): ShelfTmdbTitle | null {
  const tmdbId = typeof raw.id === "number" ? raw.id : null;
  if (!tmdbId) return null;
  const title =
    type === "movie"
      ? typeof raw.title === "string"
        ? raw.title
        : typeof raw.original_title === "string"
          ? raw.original_title
          : ""
      : typeof raw.name === "string"
        ? raw.name
        : typeof raw.original_name === "string"
          ? raw.original_name
          : "";
  if (!title) return null;
  return {
    tmdbId,
    type,
    title,
    year: yearOf(type === "movie" ? raw.release_date : raw.first_air_date),
    posterPath: typeof raw.poster_path === "string" ? raw.poster_path : null,
  };
}

export async function fetchShelfTitle(
  apiKey: string,
  tmdbId: number,
  type: ShelfMediaType,
): Promise<ShelfTmdbTitle | null> {
  const fetchJson = makeTmdbFetch(apiKey, FACTS_LANGUAGE);
  const raw = await fetchJson(`${tmdbType(type)}/${tmdbId}`);
  return raw ? parseTitle(raw, type) : null;
}

export async function fetchShelfBackdropUrl(
  apiKey: string,
  tmdbId: number,
  type: ShelfMediaType,
): Promise<string | null> {
  const fetchJson = makeTmdbFetch(apiKey, FACTS_LANGUAGE);
  const raw = await fetchJson(`${tmdbType(type)}/${tmdbId}`);
  const path =
    raw && typeof raw.backdrop_path === "string" ? raw.backdrop_path : null;
  return path ? `${TMDB_BACKDROP_BASE}${path}` : null;
}

export async function fetchShelfTmdbKey(): Promise<string | null> {
  return getLibraryTmdbApiKey();
}

const DISCOVER_PAGE_SIZE = 20;

/** One TMDB discover query, paged until `maxPages` or the last page. */
export async function discoverShelfTitles(
  apiKey: string,
  type: ShelfMediaType,
  params: Record<string, string>,
  maxPages: number,
): Promise<ShelfTmdbTitle[]> {
  const fetchJson = makeTmdbFetch(apiKey, FACTS_LANGUAGE);
  const seen = new Map<string, ShelfTmdbTitle>();
  for (let page = 1; page <= maxPages; page++) {
    const raw = await fetchJson(`discover/${tmdbType(type)}`, {
      ...params,
      page: String(page),
      include_adult: "false",
    });
    if (!raw) break;
    const results = Array.isArray(raw.results) ? raw.results : [];
    for (const item of results) {
      if (!item || typeof item !== "object") continue;
      const parsed = parseTitle(item as Record<string, unknown>, type);
      if (parsed) seen.set(`${parsed.type}:${parsed.tmdbId}`, parsed);
    }
    const totalPages =
      typeof raw.total_pages === "number" ? raw.total_pages : 1;
    if (page >= totalPages || results.length < DISCOVER_PAGE_SIZE) break;
  }
  return [...seen.values()];
}
