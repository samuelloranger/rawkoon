import type { ShelfMediaType, ShelfOrderMode } from "@rawkoon/shared/types";
import { fetchCollectionDetails } from "@rawkoon/api/utils/medias/tmdbFetcherEndpoints";
import {
  discoverShelfTitles,
  TMDB_POSTER_BASE,
  type ShelfTmdbTitle,
} from "./shelfTmdb";
import mcuTimeline from "./timelines/mcu.json";

export type SeedLanguage = "en" | "fr";

export interface SeedEntry {
  tmdbId: number;
  type: ShelfMediaType;
  season: number | null;
  title: string;
  year: number | null;
  posterPath: string | null;
  groupLabel: string | null;
}

export interface ShelfSeed {
  key: string;
  name: Record<SeedLanguage, string>;
  description: Record<SeedLanguage, string>;
  orderMode: ShelfOrderMode;
  homeRow: boolean;
  visibleFrom: string | null;
  visibleTo: string | null;
  /** Fetch (or read) the titles the seed fills the new shelf with. */
  load: (apiKey: string) => Promise<SeedEntry[]>;
}

const toEntry = (title: ShelfTmdbTitle): SeedEntry => ({
  tmdbId: title.tmdbId,
  type: title.type,
  season: null,
  title: title.title,
  year: title.year,
  posterPath: title.posterPath,
  groupLabel: null,
});

const CHRISTMAS_KEYWORD = 207317;
const DISNEY_COMPANIES = "2|6125";
const PIXAR = 3;
const GHIBLI = 10342;
const BOND_COLLECTION = 645;

const discover = (
  type: ShelfMediaType,
  params: Record<string, string>,
  maxPages: number,
) => {
  return async (apiKey: string) =>
    (await discoverShelfTitles(apiKey, type, params, maxPages)).map(toEntry);
};

/** Collection poster URLs come back as full URLs; the entry stores the bare path. */
const posterPathOf = (url: string | null): string | null =>
  url?.startsWith(TMDB_POSTER_BASE) ? url.slice(TMDB_POSTER_BASE.length) : null;

async function loadBond(apiKey: string): Promise<SeedEntry[]> {
  const collection = await fetchCollectionDetails(apiKey, BOND_COLLECTION);
  if (!collection) return [];
  return collection.parts.map((part) => ({
    tmdbId: part.tmdb_id,
    type: "movie" as const,
    season: null,
    title: part.title,
    year: part.release_year,
    posterPath: posterPathOf(part.poster_url),
    groupLabel: null,
  }));
}

function loadMcu(): SeedEntry[] {
  return mcuTimeline.entries.map((entry) => ({
    tmdbId: entry.tmdb_id,
    type: entry.type === "show" ? "show" : "movie",
    season: "season" in entry ? (entry.season ?? null) : null,
    title: entry.title,
    year: entry.year,
    posterPath: null,
    groupLabel: entry.group,
  }));
}

const SEEDS: ShelfSeed[] = [
  {
    key: "christmas",
    name: { en: "Christmas movies", fr: "Films de Noël" },
    description: {
      en: "Christmas films for the holiday season.",
      fr: "Des films de Noël pour le temps des fêtes.",
    },
    orderMode: "release",
    homeRow: true,
    visibleFrom: "11-01",
    visibleTo: "01-15",
    load: discover(
      "movie",
      {
        with_keywords: String(CHRISTMAS_KEYWORD),
        "vote_count.gte": "100",
        sort_by: "popularity.desc",
      },
      3,
    ),
  },
  {
    key: "disney",
    name: { en: "Disney", fr: "Disney" },
    description: {
      en: "Films from Walt Disney Pictures and Walt Disney Animation Studios.",
      fr: "Des films de Walt Disney Pictures et des Walt Disney Animation Studios.",
    },
    orderMode: "release",
    homeRow: false,
    visibleFrom: null,
    visibleTo: null,
    load: discover(
      "movie",
      {
        with_companies: DISNEY_COMPANIES,
        "vote_count.gte": "100",
        sort_by: "primary_release_date.asc",
      },
      25,
    ),
  },
  {
    key: "pixar",
    name: { en: "Pixar", fr: "Pixar" },
    description: {
      en: "Every Pixar feature film.",
      fr: "Tous les longs métrages de Pixar.",
    },
    orderMode: "release",
    homeRow: false,
    visibleFrom: null,
    visibleTo: null,
    load: discover(
      "movie",
      {
        with_companies: String(PIXAR),
        "vote_count.gte": "100",
        sort_by: "primary_release_date.asc",
      },
      10,
    ),
  },
  {
    key: "ghibli",
    name: { en: "Studio Ghibli", fr: "Studio Ghibli" },
    description: {
      en: "Films from Studio Ghibli.",
      fr: "Les films du Studio Ghibli.",
    },
    orderMode: "release",
    homeRow: false,
    visibleFrom: null,
    visibleTo: null,
    load: discover(
      "movie",
      {
        with_companies: String(GHIBLI),
        "vote_count.gte": "100",
        sort_by: "primary_release_date.asc",
      },
      5,
    ),
  },
  {
    key: "bond",
    name: { en: "James Bond", fr: "James Bond" },
    description: {
      en: "James Bond, in release order.",
      fr: "James Bond, dans l'ordre de sortie.",
    },
    orderMode: "release",
    homeRow: false,
    visibleFrom: null,
    visibleTo: null,
    load: loadBond,
  },
  {
    key: "mcu",
    name: {
      en: "MCU in story order",
      fr: "Le MCU dans l'ordre de l'histoire",
    },
    description: {
      en: "The Marvel Cinematic Universe in in-universe story order, films and series.",
      fr: "L'univers cinématographique Marvel dans l'ordre chronologique de l'histoire, films et séries.",
    },
    orderMode: "manual",
    homeRow: false,
    visibleFrom: null,
    visibleTo: null,
    load: async () => loadMcu(),
  },
];

export function listSeeds(): ShelfSeed[] {
  return SEEDS;
}

export function findSeed(key: string): ShelfSeed | null {
  return SEEDS.find((seed) => seed.key === key) ?? null;
}

export function seedLanguage(value: unknown): SeedLanguage {
  return value === "fr" ? "fr" : "en";
}

export function seedPosterPath(url: string | null): string | null {
  return posterPathOf(url);
}
