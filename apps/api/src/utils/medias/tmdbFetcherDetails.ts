import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import type {
  TmdbCreator,
  TmdbExternalIds,
  TmdbGenre,
  TmdbMediaDetailsResponse,
  TmdbNetwork,
  TmdbNextEpisode,
  TmdbProductionCompany,
  TmdbProductionCountry,
  TmdbSeasonSummary,
  TmdbSpokenLanguage,
  TitleTranslation,
} from "@rawkoon/shared/types";
import { toNumberOrNull, toRecord, toStringOrNull } from "./mappers";
import { makeTmdbFetch, toTmdbLanguage } from "./tmdbFetcherCore";
import {
  buildMediaStills,
  emptyMediaDetails,
  IMG_BACKDROP,
  IMG_COMPANY,
  IMG_LOGO_STILL,
  IMG_PROFILE,
  languageLabel,
  parseExternalIds,
  parseNextEpisode,
  parseYmd,
  type DetailsResult,
} from "./tmdbFetcherTypes";

type MovieFields = {
  release_date: string | null;
  runtime: number | null;
  belongs_to_collection: TmdbMediaDetailsResponse["belongs_to_collection"];
  budget: number | null;
  revenue: number | null;
};

type TvFields = {
  tv_type: string | null;
  first_air_date: string | null;
  last_air_date: string | null;
  runtime: number | null;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  networks: TmdbNetwork[];
  created_by: TmdbCreator[];
  episode_run_times: number[];
  next_episode_to_air: TmdbNextEpisode | null;
  last_episode_to_air: TmdbNextEpisode | null;
  seasons: TmdbSeasonSummary[];
};

function parseMovieFields(data: Record<string, unknown>): MovieFields {
  const release_date = parseYmd(data.release_date);
  const runtime = typeof data.runtime === "number" ? data.runtime : null;
  const budget =
    typeof data.budget === "number" && data.budget > 0 ? data.budget : null;
  const revenue =
    typeof data.revenue === "number" && data.revenue > 0 ? data.revenue : null;

  let belongs_to_collection: TmdbMediaDetailsResponse["belongs_to_collection"] =
    null;
  const col = data.belongs_to_collection as Record<string, unknown> | null;
  if (col && typeof col === "object") {
    belongs_to_collection = {
      id: typeof col.id === "number" ? col.id : 0,
      name: typeof col.name === "string" ? col.name : "",
      poster_url:
        typeof col.poster_path === "string" && col.poster_path
          ? `https://image.tmdb.org/t/p/w185${col.poster_path}`
          : null,
    };
  }

  return { release_date, runtime, belongs_to_collection, budget, revenue };
}

function parseTvFields(data: Record<string, unknown>): TvFields {
  const tv_type = toStringOrNull(data.type);
  const first_air_date = parseYmd(data.first_air_date);
  const last_air_date = parseYmd(data.last_air_date);

  const episodeRunTime = Array.isArray(data.episode_run_time)
    ? (data.episode_run_time as number[])
    : [];
  const episode_run_times = episodeRunTime.filter(
    (n) => typeof n === "number" && n > 0,
  );
  const runtime = episode_run_times.length > 0 ? episode_run_times[0] : null;
  const number_of_seasons =
    typeof data.number_of_seasons === "number" ? data.number_of_seasons : null;
  const number_of_episodes =
    typeof data.number_of_episodes === "number"
      ? data.number_of_episodes
      : null;

  const networks: TmdbNetwork[] = [];
  if (Array.isArray(data.networks)) {
    for (const n of data.networks as unknown[]) {
      const r = toRecord(n);
      if (!r) continue;
      const id = toNumberOrNull(r.id);
      const name = toStringOrNull(r.name);
      if (id == null || !name) continue;
      const logo = toStringOrNull(r.logo_path);
      networks.push({
        id,
        name,
        logo_url: logo ? `${IMG_LOGO_STILL}${logo}` : null,
      });
    }
  }

  const created_by: TmdbCreator[] = [];
  if (Array.isArray(data.created_by)) {
    for (const c of data.created_by as unknown[]) {
      const r = toRecord(c);
      if (!r) continue;
      const id = toNumberOrNull(r.id);
      const name = toStringOrNull(r.name);
      if (id == null || !name) continue;
      const pp = toStringOrNull(r.profile_path);
      created_by.push({
        id,
        name,
        profile_url: pp ? `${IMG_PROFILE}${pp}` : null,
      });
    }
  }

  const next_episode_to_air = parseNextEpisode(data.next_episode_to_air);
  const last_episode_to_air = parseNextEpisode(data.last_episode_to_air);

  const seasons: TmdbSeasonSummary[] = [];
  if (Array.isArray(data.seasons)) {
    for (const raw of data.seasons as unknown[]) {
      const r = toRecord(raw);
      if (!r) continue;
      const season_number =
        typeof r.season_number === "number" ? r.season_number : null;
      if (season_number === null) continue;
      const rawName = toStringOrNull(r.name);
      const name =
        rawName && rawName.trim()
          ? rawName.trim()
          : season_number === 0
            ? "Specials"
            : `Season ${season_number}`;
      const ep = r.episode_count;
      const episode_count = typeof ep === "number" && ep >= 0 ? ep : null;
      seasons.push({ season_number, name, episode_count });
    }
    seasons.sort((a, b) => a.season_number - b.season_number);
  }

  return {
    tv_type,
    first_air_date,
    last_air_date,
    runtime,
    number_of_seasons,
    number_of_episodes,
    networks,
    created_by,
    episode_run_times,
    next_episode_to_air,
    last_episode_to_air,
    seasons,
  };
}

/**
 * Preferred region per language when TMDB returns several regional variants of
 * the same language (e.g. fr-FR vs fr-CA). We pick the first listed region that
 * is present, falling back to whatever region TMDB returned first.
 */
const PRIMARY_REGIONS: Record<string, string[]> = {
  en: ["US", "GB"],
  fr: ["FR", "CA"],
  pt: ["PT", "BR"],
  es: ["ES", "MX"],
  zh: ["CN", "TW"],
};

/**
 * Flattens a TMDB `translations` payload into one title per language, so the
 * interactive search can offer a multi-language title picker regardless of the
 * platform's UI/TMDB language. Movies expose the title as `data.title`, TV
 * shows as `data.name`.
 */
export function extractTitleTranslations(
  translationsData: unknown,
  mediaType: "movie" | "tv",
): TitleTranslation[] {
  const root = toRecord(translationsData);
  if (!root) return [];
  const list = root.translations;
  if (!Array.isArray(list)) return [];

  const titleField = mediaType === "movie" ? "title" : "name";
  // language code -> (region -> title), preserving TMDB insertion order.
  const byLanguage = new Map<string, Map<string, string>>();

  for (const entry of list as unknown[]) {
    const rec = toRecord(entry);
    if (!rec) continue;
    const language = toStringOrNull(rec.iso_639_1)?.toLowerCase();
    if (!language) continue;
    const data = toRecord(rec.data);
    const title = toStringOrNull(data?.[titleField])?.trim();
    if (!title) continue;
    const region = (toStringOrNull(rec.iso_3166_1) ?? "").toUpperCase();
    if (!byLanguage.has(language)) byLanguage.set(language, new Map());
    const regions = byLanguage.get(language)!;
    if (!regions.has(region)) regions.set(region, title);
  }

  const result: TitleTranslation[] = [];
  for (const [language, regions] of byLanguage) {
    let title: string | undefined;
    for (const region of PRIMARY_REGIONS[language] ?? []) {
      if (regions.has(region)) {
        title = regions.get(region);
        break;
      }
    }
    if (!title) title = regions.values().next().value;
    if (title) result.push({ language_code: language, title });
  }
  return result;
}

export async function fetchMediaDetails(
  apiKey: string,
  mediaType: "movie" | "tv",
  tmdbId: number,
  language = "en-US",
): Promise<DetailsResult> {
  const tmdbLanguage = toTmdbLanguage(language);
  const cacheKey = `medias:tmdb-details-v4:${mediaType}:${tmdbId}:${tmdbLanguage}`;
  const cached = await getJsonCache<DetailsResult>(cacheKey);
  if (cached) return cached;

  const empty = emptyMediaDetails();
  const tmdbFetch = makeTmdbFetch(apiKey, tmdbLanguage);

  try {
    const data = await tmdbFetch(`${mediaType}/${tmdbId}`, {
      append_to_response: "external_ids,images,translations",
    });
    if (!data) return empty;

    const overview =
      typeof data.overview === "string" ? data.overview || null : null;
    const vote_average =
      typeof data.vote_average === "number" ? data.vote_average : null;
    const tagline =
      typeof data.tagline === "string" && data.tagline.trim()
        ? data.tagline.trim()
        : null;

    const genres: TmdbGenre[] = Array.isArray(data.genres)
      ? (data.genres as unknown[])
          .map((g) => {
            const gr = toRecord(g);
            if (!gr) return null;
            const id = toNumberOrNull(gr.id);
            const name = toStringOrNull(gr.name);
            if (id == null || !name) return null;
            return { id, name };
          })
          .filter((g): g is TmdbGenre => g !== null)
      : [];

    const original_title =
      mediaType === "movie"
        ? toStringOrNull(data.original_title)
        : toStringOrNull(data.original_name ?? data.original_title);
    const original_language = toStringOrNull(data.original_language);
    const title_translations = extractTitleTranslations(
      data.translations,
      mediaType,
    );

    const production_countries: TmdbProductionCountry[] = Array.isArray(
      data.production_countries,
    )
      ? (data.production_countries as unknown[])
          .map((c) => {
            const r = toRecord(c);
            if (!r) return null;
            const iso = toStringOrNull(r.iso_3166_1);
            const name = toStringOrNull(r.name);
            if (!iso || !name) return null;
            return { iso_3166_1: iso, name };
          })
          .filter((x): x is TmdbProductionCountry => x !== null)
      : [];

    const production_companies: TmdbProductionCompany[] = Array.isArray(
      data.production_companies,
    )
      ? (data.production_companies as unknown[])
          .map((c) => {
            const r = toRecord(c);
            if (!r) return null;
            const id = toNumberOrNull(r.id);
            const name = toStringOrNull(r.name);
            if (id == null || !name) return null;
            const logo = toStringOrNull(r.logo_path);
            return {
              id,
              name,
              logo_url: logo ? `${IMG_COMPANY}${logo}` : null,
              origin_country: toStringOrNull(r.origin_country),
            };
          })
          .filter((x): x is TmdbProductionCompany => x !== null)
      : [];

    const spoken_languages: TmdbSpokenLanguage[] = Array.isArray(
      data.spoken_languages,
    )
      ? (data.spoken_languages as unknown[])
          .map((c) => {
            const r = toRecord(c);
            if (!r) return null;
            const en = toStringOrNull(r.english_name);
            const iso = toStringOrNull(r.iso_639_1);
            const name = toStringOrNull(r.name);
            if (!iso || !name) return null;
            return {
              english_name: en || name,
              iso_639_1: iso,
              name,
            };
          })
          .filter((x): x is TmdbSpokenLanguage => x !== null)
      : [];

    const original_language_label = languageLabel(
      original_language,
      spoken_languages,
    );

    const homepage = toStringOrNull(data.homepage);

    const extParsed = parseExternalIds(data.external_ids);
    const imdbFallback = toStringOrNull(data.imdb_id);
    const mergedExternal: TmdbExternalIds = {
      imdb_id: extParsed?.imdb_id ?? imdbFallback,
      facebook_id: extParsed?.facebook_id ?? null,
      instagram_id: extParsed?.instagram_id ?? null,
      twitter_id: extParsed?.twitter_id ?? null,
      wikidata_id: extParsed?.wikidata_id ?? null,
    };
    const hasExternal =
      mergedExternal.imdb_id ||
      mergedExternal.facebook_id ||
      mergedExternal.instagram_id ||
      mergedExternal.twitter_id ||
      mergedExternal.wikidata_id;
    const external_ids: TmdbExternalIds | null = hasExternal
      ? mergedExternal
      : null;

    const imagesRaw = toRecord(data.images);
    const media_stills = buildMediaStills(imagesRaw);

    const backdropPath = toStringOrNull(data.backdrop_path);
    const primary_backdrop_url = backdropPath
      ? `${IMG_BACKDROP}${backdropPath}`
      : null;

    const status: string | null =
      typeof data.status === "string" && data.status.trim()
        ? data.status.trim()
        : null;

    const movieFields = mediaType === "movie" ? parseMovieFields(data) : null;
    const tvFields = mediaType === "tv" ? parseTvFields(data) : null;

    const result: TmdbMediaDetailsResponse = {
      runtime: movieFields?.runtime ?? tvFields?.runtime ?? null,
      belongs_to_collection: movieFields?.belongs_to_collection ?? null,
      overview,
      vote_average,
      number_of_seasons: tvFields?.number_of_seasons ?? null,
      number_of_episodes: tvFields?.number_of_episodes ?? null,
      release_date: movieFields?.release_date ?? null,
      tagline,
      genres,
      first_air_date: tvFields?.first_air_date ?? null,
      last_air_date: tvFields?.last_air_date ?? null,
      status,
      original_title,
      title_translations,
      original_language,
      original_language_label,
      production_countries,
      production_companies,
      spoken_languages,
      budget: movieFields?.budget ?? null,
      revenue: movieFields?.revenue ?? null,
      homepage,
      external_ids,
      primary_backdrop_url,
      media_stills,
      tv_type: tvFields?.tv_type ?? null,
      networks: tvFields?.networks ?? [],
      created_by: tvFields?.created_by ?? [],
      episode_run_times: tvFields?.episode_run_times ?? [],
      next_episode_to_air: tvFields?.next_episode_to_air ?? null,
      last_episode_to_air: tvFields?.last_episode_to_air ?? null,
      seasons: tvFields?.seasons ?? [],
    };
    await setJsonCache(cacheKey, result, 24 * 60 * 60);
    return result;
  } catch {
    return empty;
  }
}
