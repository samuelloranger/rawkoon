import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import type { TmdbWatchProvidersResult } from "./mappers";
import { toStringOrNull } from "./mappers";
import { makeTmdbFetch, toTmdbLanguage } from "./tmdbFetcherCore";
import {
  fetchMediaDetails,
  MEDIA_DETAILS_APPEND,
  MEDIA_DETAILS_TTL,
  mediaDetailsCacheKey,
  parseMediaDetails,
} from "./tmdbFetcherDetails";
import {
  CREDITS_TTL,
  creditsCacheKey,
  EMPTY_RATINGS,
  fetchCredits,
  fetchOmdbRatings,
  fetchRatings,
  fetchTrailer,
  fetchWatchProviders,
  parseCredits,
  parseTrailer,
  parseWatchProviders,
  PROVIDERS_TTL,
  providersCacheKey,
  RATINGS_TTL,
  ratingsCacheKey,
  TRAILER_TTL,
  trailerCacheKey,
} from "./tmdbFetcherEndpoints";
import type {
  CreditsResult,
  DetailsResult,
  RatingsResult,
  TrailerResult,
} from "./tmdbFetcherTypes";

export type ModalTmdbData = {
  trailer: TrailerResult;
  ratings: RatingsResult;
  credits: CreditsResult;
  details: DetailsResult;
  providers: TmdbWatchProvidersResult;
};

/**
 * Everything the media modal needs from TMDB, in one `append_to_response`
 * request for the parts missing from cache. Seeds the same cache keys as the
 * single-resource fetchers, and falls back to them if the combined request
 * fails (TMDB 500s on some titles when sub-resources are appended).
 */
export async function fetchModalTmdbData(
  apiKey: string,
  mediaType: "movie" | "tv",
  tmdbId: number,
  region: string,
  language = "en-US",
): Promise<ModalTmdbData> {
  const lang = toTmdbLanguage(language);
  const keys = {
    trailer: trailerCacheKey(mediaType, tmdbId, lang),
    ratings: ratingsCacheKey(mediaType, tmdbId, lang),
    credits: creditsCacheKey(mediaType, tmdbId, lang),
    details: mediaDetailsCacheKey(mediaType, tmdbId, lang),
    providers: providersCacheKey(mediaType, tmdbId, region, lang),
  };
  const [trailer, ratings, credits, details, providers] = await Promise.all([
    getJsonCache<TrailerResult>(keys.trailer),
    getJsonCache<RatingsResult>(keys.ratings),
    getJsonCache<CreditsResult>(keys.credits),
    getJsonCache<DetailsResult>(keys.details),
    getJsonCache<TmdbWatchProvidersResult>(keys.providers),
  ]);
  if (trailer && ratings && credits && details && providers) {
    return { trailer, ratings, credits, details, providers };
  }

  // Ratings only cache on an OMDb hit, so without a key they always miss; don't let that force a fetch.
  const wantsRatings = !ratings && Boolean(Bun.env.OMDB_API_KEY);
  const append = new Set<string>();
  if (!details)
    for (const part of MEDIA_DETAILS_APPEND.split(",")) append.add(part);
  if (!trailer) append.add("videos");
  if (!credits) append.add("credits");
  if (!providers) append.add("watch/providers");
  if (wantsRatings) append.add("external_ids");

  const data =
    append.size > 0
      ? await makeTmdbFetch(apiKey, lang)(`${mediaType}/${tmdbId}`, {
          append_to_response: [...append].join(","),
        }).catch(() => null)
      : null;

  const perResource = async (): Promise<ModalTmdbData> => {
    const [t, r, c, d, p] = await Promise.all([
      trailer ?? fetchTrailer(apiKey, mediaType, tmdbId, lang),
      ratings ?? fetchRatings(apiKey, mediaType, tmdbId, lang),
      credits ?? fetchCredits(apiKey, mediaType, tmdbId, lang),
      details ?? fetchMediaDetails(apiKey, mediaType, tmdbId, lang),
      providers ?? fetchWatchProviders(apiKey, mediaType, tmdbId, region, lang),
    ]);
    return { trailer: t, ratings: r, credits: c, details: d, providers: p };
  };
  if (append.size > 0 && !data) return perResource();

  const writes: Promise<unknown>[] = [];
  const fill = <T>(
    cached: T | null,
    key: string,
    ttl: number,
    parse: () => T,
  ) => {
    if (cached) return cached;
    const value = parse();
    writes.push(setJsonCache(key, value, ttl));
    return value;
  };

  let result: ModalTmdbData;
  try {
    result = {
      trailer: fill(trailer, keys.trailer, TRAILER_TTL, () =>
        parseTrailer(data?.videos),
      ),
      credits: fill(credits, keys.credits, CREDITS_TTL, () =>
        parseCredits(data?.credits),
      ),
      details: fill(details, keys.details, MEDIA_DETAILS_TTL, () =>
        parseMediaDetails(data ?? {}, mediaType),
      ),
      providers: fill(providers, keys.providers, PROVIDERS_TTL, () =>
        parseWatchProviders(data?.["watch/providers"], region),
      ),
      ratings: ratings ?? EMPTY_RATINGS,
    };
  } catch {
    // Same contract as the single-resource fetchers: a bad payload degrades, never 500s the modal.
    return perResource();
  }

  if (wantsRatings) {
    const external = data?.external_ids as Record<string, unknown> | undefined;
    const imdbId =
      toStringOrNull(external?.imdb_id) ?? toStringOrNull(data?.imdb_id);
    const omdb = imdbId
      ? await fetchOmdbRatings(imdbId).catch(() => null)
      : null;
    if (omdb) {
      result.ratings = omdb;
      writes.push(setJsonCache(keys.ratings, omdb, RATINGS_TTL));
    }
  }

  await Promise.all(writes);
  return result;
}
