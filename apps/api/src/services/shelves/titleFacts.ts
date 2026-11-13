import type { ShelfMediaType } from "@rawkoon/shared/types";
import { tmdbApiFetch } from "@rawkoon/api/utils/medias/libraryHelpers";
import { tmdbType } from "./shelfTmdb";

/** The TMDB facts shelf rules are evaluated against, as stored on `LibraryMedia`. */
export interface TitleFacts {
  genreIds: number[];
  keywordIds: number[];
  companyIds: number[];
  networkIds: number[];
  tmdbCollectionId: number | null;
  certification: string | null;
  voteCount: number | null;
  voteAverage: number | null;
}

const FALLBACK_COUNTRY = "US";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const idsOf = (list: unknown): number[] =>
  Array.isArray(list)
    ? [
        ...new Set(
          list
            .map((item) => asRecord(item).id)
            .filter((id): id is number => typeof id === "number"),
        ),
      ]
    : [];

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** A movie's rating in one country: the theatrical one when there is one, else the first non-empty. */
function movieCertification(releaseDates: unknown, country: string) {
  const results = asRecord(releaseDates).results;
  const entry = Array.isArray(results)
    ? results.find((r) => asRecord(r).iso_3166_1 === country)
    : null;
  const dates = asRecord(entry).release_dates;
  if (!Array.isArray(dates)) return null;
  const rated = dates
    .map((d) => asRecord(d))
    .filter((d) => nonEmpty(d.certification));
  const theatrical = rated.find((d) => d.type === 3);
  return nonEmpty((theatrical ?? rated[0])?.certification);
}

function showCertification(contentRatings: unknown, country: string) {
  const results = asRecord(contentRatings).results;
  const entry = Array.isArray(results)
    ? results.find((r) => asRecord(r).iso_3166_1 === country)
    : null;
  return nonEmpty(asRecord(entry).rating);
}

/**
 * Reads one TMDB details payload (fetched with `keywords` and `release_dates` /
 * `content_ratings` appended) into facts. A country with no rating falls back to US.
 */
export function parseTitleFacts(
  raw: Record<string, unknown>,
  type: ShelfMediaType,
  country: string,
): TitleFacts {
  const certificationFor = (c: string) =>
    type === "movie"
      ? movieCertification(raw.release_dates, c)
      : showCertification(raw.content_ratings, c);
  // Movies key keywords as `keywords`, shows as `results`
  const keywords = asRecord(raw.keywords);
  return {
    genreIds: idsOf(raw.genres),
    keywordIds: idsOf(type === "movie" ? keywords.keywords : keywords.results),
    companyIds: idsOf(raw.production_companies),
    networkIds: type === "show" ? idsOf(raw.networks) : [],
    tmdbCollectionId:
      type === "movie"
        ? numberOrNull(asRecord(raw.belongs_to_collection).id)
        : null,
    certification:
      certificationFor(country) ??
      (country === FALLBACK_COUNTRY
        ? null
        : certificationFor(FALLBACK_COUNTRY)),
    voteCount: numberOrNull(raw.vote_count),
    voteAverage: numberOrNull(raw.vote_average),
  };
}

/** Facts for one title, always en-US so rules resolve the same for every account. Throws on a non-2xx. */
export async function fetchTitleFacts(
  apiKey: string,
  tmdbId: number,
  type: ShelfMediaType,
  country: string,
): Promise<TitleFacts> {
  const raw = await tmdbApiFetch<Record<string, unknown>>(
    `${tmdbType(type)}/${tmdbId}`,
    apiKey,
    {
      language: "en-US",
      append_to_response:
        type === "movie"
          ? "keywords,release_dates"
          : "keywords,content_ratings",
    },
  );
  return parseTitleFacts(raw, type, country);
}
