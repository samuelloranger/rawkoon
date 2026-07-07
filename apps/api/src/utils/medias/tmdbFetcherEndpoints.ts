import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import {
  toRecord,
  toStringOrNull,
  type TmdbProvider,
  type TmdbWatchProvidersResult,
} from "./mappers";
import { makeTmdbFetch, toTmdbLanguage } from "./tmdbFetcherCore";
import type {
  CollectionPart,
  CreditsResult,
  RatingsResult,
  TmdbCollectionData,
  TrailerResult,
} from "./tmdbFetcherTypes";

export async function fetchTrailer(
  apiKey: string,
  mediaType: "movie" | "tv",
  tmdbId: number,
  language = "en-US",
): Promise<TrailerResult> {
  const lang = toTmdbLanguage(language);
  const cacheKey = `medias:trailer:${mediaType}:${tmdbId}:${lang}`;
  const cached = await getJsonCache<TrailerResult>(cacheKey);
  if (cached) return cached;

  const tmdbFetch = makeTmdbFetch(apiKey, lang);
  try {
    const data = await tmdbFetch(`${mediaType}/${tmdbId}/videos`);
    const results = Array.isArray(data?.results)
      ? (data!.results as Record<string, unknown>[])
      : [];
    const youtube = results.filter((v) => v.site === "YouTube");
    const pick =
      youtube.find((v) => v.official && v.type === "Trailer") ??
      youtube.find((v) => v.official && v.type === "Teaser") ??
      youtube.find((v) => v.type === "Trailer") ??
      youtube.find((v) => v.type === "Teaser") ??
      youtube[0] ??
      null;
    const result: TrailerResult = {
      key: pick ? toStringOrNull(pick.key) : null,
      name: pick ? toStringOrNull(pick.name) : null,
    };
    await setJsonCache(cacheKey, result, 24 * 60 * 60);
    return result;
  } catch {
    return { key: null, name: null };
  }
}

export async function fetchRatings(
  apiKey: string,
  mediaType: "movie" | "tv",
  tmdbId: number,
  language = "en-US",
): Promise<RatingsResult> {
  const lang = toTmdbLanguage(language);
  const cacheKey = `medias:ratings:${mediaType}:${tmdbId}:${lang}`;
  const cached = await getJsonCache<RatingsResult>(cacheKey);
  if (cached) return cached;

  const empty: RatingsResult = {
    imdb_rating: null,
    rotten_tomatoes: null,
    metacritic: null,
  };
  const omdbKey = Bun.env.OMDB_API_KEY;
  if (!omdbKey) return empty;

  const tmdbFetch = makeTmdbFetch(apiKey, lang);
  try {
    const extData = await tmdbFetch(`${mediaType}/${tmdbId}/external_ids`);
    const imdbId =
      typeof extData?.imdb_id === "string" ? extData.imdb_id : null;
    if (!imdbId) return empty;

    const omdbUrl = new URL("https://www.omdbapi.com/");
    omdbUrl.searchParams.set("i", imdbId);
    omdbUrl.searchParams.set("apikey", omdbKey);
    const res = await fetch(omdbUrl.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return empty;

    const data = (await res.json()) as Record<string, unknown>;
    if (data.Response === "False") return empty;

    const ratings = Array.isArray(data.Ratings)
      ? (data.Ratings as { Source: string; Value: string }[])
      : [];
    const rtRaw =
      ratings.find((r) => r.Source === "Rotten Tomatoes")?.Value ?? null;
    const mcRaw =
      ratings
        .find((r) => r.Source === "Metacritic")
        ?.Value?.replace("/100", "") ?? null;
    const result: RatingsResult = {
      imdb_rating:
        typeof data.imdbRating === "string" && data.imdbRating !== "N/A"
          ? data.imdbRating
          : null,
      rotten_tomatoes:
        rtRaw && rtRaw !== "N/A" && rtRaw !== "0%" ? rtRaw : null,
      metacritic: mcRaw && mcRaw !== "N/A" && mcRaw !== "0" ? mcRaw : null,
    };
    await setJsonCache(cacheKey, result, 24 * 60 * 60);
    return result;
  } catch {
    return empty;
  }
}

export async function fetchCredits(
  apiKey: string,
  mediaType: "movie" | "tv",
  tmdbId: number,
  language = "en-US",
): Promise<CreditsResult> {
  const lang = toTmdbLanguage(language);
  const cacheKey = `medias:credits:${mediaType}:${tmdbId}:${lang}`;
  const cached = await getJsonCache<CreditsResult>(cacheKey);
  if (cached) return cached;

  const tmdbFetch = makeTmdbFetch(apiKey, lang);
  try {
    const data = await tmdbFetch(`${mediaType}/${tmdbId}/credits`);
    const castArr = Array.isArray(data?.cast)
      ? (data!.cast as Record<string, unknown>[])
      : [];
    const crewArr = Array.isArray(data?.crew)
      ? (data!.crew as Record<string, unknown>[])
      : [];
    const result: CreditsResult = {
      cast: castArr.slice(0, 10).map((m) => ({
        id: typeof m.id === "number" ? m.id : 0,
        name: typeof m.name === "string" ? m.name : "",
        character: typeof m.character === "string" ? m.character : null,
        profile_url:
          typeof m.profile_path === "string" && m.profile_path
            ? `https://image.tmdb.org/t/p/w185${m.profile_path}`
            : null,
      })),
      directors: crewArr
        .filter((m) => m.job === "Director")
        .map((m) => (typeof m.name === "string" ? m.name : ""))
        .filter(Boolean),
    };
    await setJsonCache(cacheKey, result, 24 * 60 * 60);
    return result;
  } catch {
    return { cast: [], directors: [] };
  }
}

export async function fetchCollectionDetails(
  apiKey: string,
  collectionId: number,
  language = "en-US",
): Promise<TmdbCollectionData | null> {
  const lang = toTmdbLanguage(language);
  const cacheKey = `medias:collection:${collectionId}:${lang}`;
  const cached = await getJsonCache<TmdbCollectionData>(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL(
      `https://api.themoviedb.org/3/collection/${collectionId}`,
    );
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("language", lang);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    const POSTER_BASE = "https://image.tmdb.org/t/p/w342";
    const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";

    const parts = Array.isArray(data.parts)
      ? (data.parts as Record<string, unknown>[])
      : [];
    const result: TmdbCollectionData = {
      id: typeof data.id === "number" ? data.id : collectionId,
      name: typeof data.name === "string" ? data.name : "",
      overview:
        typeof data.overview === "string" ? data.overview || null : null,
      poster_url:
        typeof data.poster_path === "string" && data.poster_path
          ? `${POSTER_BASE}${data.poster_path}`
          : null,
      backdrop_url:
        typeof data.backdrop_path === "string" && data.backdrop_path
          ? `${BACKDROP_BASE}${data.backdrop_path}`
          : null,
      parts: parts
        .map((p) => {
          const tmdb_id = typeof p.id === "number" ? p.id : null;
          if (!tmdb_id) return null;
          const dateStr =
            typeof p.release_date === "string" ? p.release_date : "";
          const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) : null;
          return {
            tmdb_id,
            title: typeof p.title === "string" ? p.title : "",
            release_year: year && !isNaN(year) ? year : null,
            release_date: dateStr || null,
            poster_url:
              typeof p.poster_path === "string" && p.poster_path
                ? `${POSTER_BASE}${p.poster_path}`
                : null,
            overview:
              typeof p.overview === "string" ? p.overview || null : null,
            vote_average:
              typeof p.vote_average === "number" ? p.vote_average : null,
          } satisfies CollectionPart;
        })
        .filter((p): p is CollectionPart => p !== null)
        .sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999)),
    };

    await setJsonCache(cacheKey, result, 24 * 60 * 60);
    return result;
  } catch {
    return null;
  }
}

export function mapProviders(raw: unknown[], logoBase: string): TmdbProvider[] {
  const seen = new Set<number>();
  return raw
    .map((item) => {
      const p = toRecord(item);
      if (!p) return null;
      const id =
        typeof p.provider_id === "number" ? Math.trunc(p.provider_id) : null;
      const name = toStringOrNull(p.provider_name);
      const logoPath = toStringOrNull(p.logo_path);
      if (!id || !name || !logoPath || seen.has(id)) return null;
      seen.add(id);
      return { id, name, logo_url: `${logoBase}${logoPath}` };
    })
    .filter((p): p is TmdbProvider => p !== null);
}

export async function fetchWatchProviders(
  apiKey: string,
  mediaType: "movie" | "tv",
  tmdbId: number,
  region: string,
  language = "en-US",
): Promise<TmdbWatchProvidersResult> {
  const lang = toTmdbLanguage(language);
  const cacheKey = `medias:providers:${mediaType}:${tmdbId}:${region}:${lang}`;
  const cached = await getJsonCache<TmdbWatchProvidersResult>(cacheKey);
  if (cached) return cached;

  const LOGO_BASE = "https://image.tmdb.org/t/p/w92";
  const empty: TmdbWatchProvidersResult = {
    region,
    streaming: [],
    free: [],
    rent: [],
    buy: [],
    link: null,
  };

  try {
    const url = new URL(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers`,
    );
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("language", lang);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return empty;

    const data = (await res.json()) as Record<string, unknown>;
    const results = toRecord(data.results);
    const regionData = toRecord(results?.[region]);

    const result: TmdbWatchProvidersResult = {
      region,
      streaming: regionData
        ? mapProviders(
            Array.isArray(regionData.flatrate)
              ? (regionData.flatrate as unknown[])
              : [],
            LOGO_BASE,
          )
        : [],
      free: regionData
        ? mapProviders(
            Array.isArray(regionData.free)
              ? (regionData.free as unknown[])
              : [],
            LOGO_BASE,
          )
        : [],
      rent: regionData
        ? mapProviders(
            Array.isArray(regionData.rent)
              ? (regionData.rent as unknown[])
              : [],
            LOGO_BASE,
          )
        : [],
      buy: regionData
        ? mapProviders(
            Array.isArray(regionData.buy) ? (regionData.buy as unknown[]) : [],
            LOGO_BASE,
          )
        : [],
      link: regionData ? toStringOrNull(regionData.link) : null,
    };
    await setJsonCache(cacheKey, result, 6 * 60 * 60);
    return result;
  } catch {
    return empty;
  }
}
