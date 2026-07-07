import type {
  TmdbExternalIds,
  TmdbImageStill,
  TmdbMediaDetailsResponse,
  TmdbMediaStills,
  TmdbNextEpisode,
  TmdbSpokenLanguage,
} from "@rawkoon/shared/types";
import { toNumberOrNull, toRecord, toStringOrNull } from "./mappers";

// ── Return types ────────────────────────────────────────────────────────────

export type TrailerResult = {
  key: string | null;
  name: string | null;
};

export type RatingsResult = {
  imdb_rating: string | null;
  rotten_tomatoes: string | null;
  metacritic: string | null;
};

export type CreditsResult = {
  cast: {
    id: number;
    name: string;
    character: string | null;
    profile_url: string | null;
  }[];
  directors: string[];
};

export type DetailsResult = TmdbMediaDetailsResponse;

export type CollectionPart = {
  tmdb_id: number;
  title: string;
  release_year: number | null;
  release_date: string | null;
  poster_url: string | null;
  overview: string | null;
  vote_average: number | null;
};

export type TmdbCollectionData = {
  id: number;
  name: string;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  parts: CollectionPart[];
};

export const IMG_BACKDROP = "https://image.tmdb.org/t/p/w1280";
export const IMG_BACKDROP_STILL = "https://image.tmdb.org/t/p/w780";
export const IMG_POSTER_STILL = "https://image.tmdb.org/t/p/w342";
export const IMG_LOGO_STILL = "https://image.tmdb.org/t/p/w185";
export const IMG_COMPANY = "https://image.tmdb.org/t/p/w92";
export const IMG_PROFILE = "https://image.tmdb.org/t/p/w185";

/** TMDB `language` for library rows (title, overview, episode names) — always English. */
export const TMDB_LANGUAGE_LIBRARY_PERSISTENCE = "en-US";

export function emptyMediaDetails(): TmdbMediaDetailsResponse {
  return {
    runtime: null,
    belongs_to_collection: null,
    overview: null,
    vote_average: null,
    number_of_seasons: null,
    number_of_episodes: null,
    release_date: null,
    tagline: null,
    genres: [],
    first_air_date: null,
    last_air_date: null,
    status: null,
    original_title: null,
    title_translations: [],
    original_language: null,
    original_language_label: null,
    production_countries: [],
    production_companies: [],
    spoken_languages: [],
    budget: null,
    revenue: null,
    homepage: null,
    external_ids: null,
    primary_backdrop_url: null,
    media_stills: { backdrops: [], logos: [], posters: [] },
    tv_type: null,
    networks: [],
    created_by: [],
    episode_run_times: [],
    next_episode_to_air: null,
    last_episode_to_air: null,
    seasons: [],
  };
}

export function parseYmd(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function parseExternalIds(raw: unknown): TmdbExternalIds | null {
  const row = toRecord(raw);
  if (!row) return null;
  return {
    imdb_id: toStringOrNull(row.imdb_id),
    facebook_id: toStringOrNull(row.facebook_id),
    instagram_id: toStringOrNull(row.instagram_id),
    twitter_id: toStringOrNull(row.twitter_id),
    wikidata_id: toStringOrNull(row.wikidata_id),
  };
}

export function parseImageStills(
  images: unknown,
  kind: "backdrop" | "poster" | "logo",
): TmdbImageStill[] {
  const root = toRecord(images);
  if (!root) return [];
  const key =
    kind === "backdrop" ? "backdrops" : kind === "poster" ? "posters" : "logos";
  const arr = Array.isArray(root[key]) ? (root[key] as unknown[]) : [];
  const size =
    kind === "backdrop"
      ? IMG_BACKDROP_STILL
      : kind === "poster"
        ? IMG_POSTER_STILL
        : IMG_LOGO_STILL;
  const mapped: TmdbImageStill[] = [];
  for (const raw of arr) {
    const r = toRecord(raw);
    if (!r) continue;
    const path = toStringOrNull(r.file_path);
    if (!path) continue;
    mapped.push({
      url: `${size}${path}`,
      width: toNumberOrNull(r.width),
      height: toNumberOrNull(r.height),
      vote_average: typeof r.vote_average === "number" ? r.vote_average : null,
    });
  }
  mapped.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
  return mapped.slice(0, 12);
}

export function parseNextEpisode(raw: unknown): TmdbNextEpisode | null {
  const row = toRecord(raw);
  if (!row) return null;
  const air = parseYmd(row.air_date);
  const ep: TmdbNextEpisode = {
    name: toStringOrNull(row.name),
    air_date: air,
    episode_number: toNumberOrNull(row.episode_number),
    season_number: toNumberOrNull(row.season_number),
    runtime: toNumberOrNull(row.runtime),
  };
  if (
    !ep.name &&
    !ep.air_date &&
    ep.episode_number == null &&
    ep.season_number == null &&
    ep.runtime == null
  ) {
    return null;
  }
  return ep;
}

export function languageLabel(
  iso: string | null,
  spoken: TmdbSpokenLanguage[],
): string | null {
  if (!iso) return null;
  const match = spoken.find((s) => s.iso_639_1 === iso);
  if (match) return match.english_name || match.name;
  const map: Record<string, string> = {
    en: "English",
    fr: "French",
    es: "Spanish",
    de: "German",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
  };
  return map[iso] ?? iso.toUpperCase();
}

export function buildMediaStills(
  imagesRaw: Record<string, unknown> | null,
): TmdbMediaStills {
  return {
    backdrops: parseImageStills(imagesRaw, "backdrop"),
    logos: parseImageStills(imagesRaw, "logo"),
    posters: parseImageStills(imagesRaw, "poster"),
  };
}
