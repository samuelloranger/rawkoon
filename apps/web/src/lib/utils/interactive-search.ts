import type { InteractiveReleaseItem } from "@rawkoon/shared/types";

export type InteractiveSortKey =
  | "seeders"
  | "age"
  | "size"
  | "title"
  | "quality";
export type InteractiveSortDir = "asc" | "desc";

export const UNKNOWN_TRACKER_KEY = "__unknown_tracker__";
export const UNKNOWN_LANGUAGE_KEY = "__unknown_language__";

export interface TitleOption {
  /** ISO 639-1 language code (e.g. "en", "fr", "ja") */
  languageCode: string;
  /** The full search query for this language (title + any season/episode suffix) */
  query: string;
  /** True when this language is the media's original language */
  isOriginal: boolean;
}

/** A title option enriched with a display label, ready to render in the picker. */
export interface LabeledTitleOption extends TitleOption {
  label: string;
}

/**
 * Languages shown in the search-title picker (beyond the platform language,
 * English, French, and the original language) when TMDB has a title for them.
 */
const COMMON_TITLE_LANGUAGES = [
  "es",
  "de",
  "it",
  "pt",
  "ja",
  "ko",
  "zh",
  "ru",
] as const;

/**
 * Builds the ordered list of search-title options for the interactive-search
 * language picker. Private trackers name releases with different localized
 * titles, so the user can pick which language's title to search by.
 *
 * Order: the platform language first (the default query), then English and
 * French pinned, then the original-language title, then the common allowlist —
 * each included only when a non-empty title exists. Options are deduped by
 * query (case-insensitive) so the same title never appears twice.
 */
export function buildTitleOptions(input: {
  localized: string;
  platformLanguage: string;
  original?: string | null;
  originalLanguage?: string | null;
  translations?: { language_code: string; title: string }[];
  suffix?: string;
}): TitleOption[] {
  const suffix = input.suffix ?? "";
  const platform = (input.platformLanguage || "").toLowerCase();
  const originalLanguage = (input.originalLanguage || "").toLowerCase();

  const translationByLang = new Map<string, string>();
  for (const entry of input.translations ?? []) {
    const code = entry.language_code?.toLowerCase();
    const title = entry.title?.trim();
    if (code && title && !translationByLang.has(code)) {
      translationByLang.set(code, title);
    }
  }

  // Ordered candidates: the platform (localized) title is the default; EN/FR
  // are pinned; the original-language title is offered next — tagged, and kept
  // even when it shares the platform language but differs from the localized
  // title (preserving the old localized↔original choice); then the common
  // allowlist. Each candidate tracks whether it is the platform/original title
  // so we never mislabel the localized title as the original.
  type TitleCandidate = {
    languageCode: string;
    title: string | null;
    isOriginal: boolean;
    isPlatform: boolean;
  };

  // Languages already represented by the platform or original entries; their
  // pinned/common translation slots are skipped so we don't surface a less
  // canonical translation next to the authoritative title.
  const coveredCodes = new Set([platform, originalLanguage].filter(Boolean));

  const candidates: TitleCandidate[] = [
    {
      languageCode: platform,
      title: input.localized,
      isOriginal: false,
      isPlatform: true,
    },
  ];
  for (const code of ["en", "fr"]) {
    if (!coveredCodes.has(code)) {
      candidates.push({
        languageCode: code,
        title: translationByLang.get(code) ?? null,
        isOriginal: false,
        isPlatform: false,
      });
    }
  }
  if (originalLanguage) {
    candidates.push({
      languageCode: originalLanguage,
      title:
        input.original?.trim() ||
        translationByLang.get(originalLanguage) ||
        null,
      isOriginal: true,
      isPlatform: false,
    });
  }
  for (const code of COMMON_TITLE_LANGUAGES) {
    if (!coveredCodes.has(code)) {
      candidates.push({
        languageCode: code,
        title: translationByLang.get(code) ?? null,
        isOriginal: false,
        isPlatform: false,
      });
    }
  }

  const options: TitleOption[] = [];
  const seenQueries = new Set<string>();
  for (const candidate of candidates) {
    const base = candidate.title?.trim();
    // The platform title is always kept; secondary titles need 2+ chars to
    // avoid noisy single-letter indexer queries.
    const minLength = candidate.isPlatform ? 1 : 2;
    if (!base || base.length < minLength) continue;
    const query = `${base}${suffix}`;
    const dedupeKey = query.toLocaleLowerCase();
    if (seenQueries.has(dedupeKey)) continue;
    seenQueries.add(dedupeKey);
    options.push({
      languageCode: candidate.languageCode,
      query,
      isOriginal: candidate.isOriginal,
    });
  }
  return options;
}

export const normalizeFilterKey = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .trim()
    .toLocaleLowerCase();

export interface FilterParams {
  filterQuery: string;
  hideRejected: boolean;
  includedTrackers: string[];
  excludedTrackers: string[];
  includedLanguages: string[];
  sortBy: InteractiveSortKey;
  sortDir: InteractiveSortDir;
  isSearchMode?: boolean;
  /** Expected media title — used for client-side title/year rejection in Prowlarr mode */
  mediaTitle?: string | null;
  /** Expected media year — used for client-side year mismatch rejection in Prowlarr mode */
  mediaYear?: number | null;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "has",
  "him",
  "his",
  "how",
  "its",
  "let",
  "new",
  "now",
  "old",
  "see",
  "two",
  "way",
  "who",
  "did",
  "via",
]);

/**
 * Client-side rejection heuristic for Prowlarr results (no arr service involvement).
 * Rejects a release if:
 *  - The release title contains a 4-digit year that doesn't match the expected year, OR
 *  - The release title is missing too many distinctive words from the expected media title.
 */
function isClientRejected(
  releaseTitle: string,
  mediaTitle: string,
  mediaYear?: number | null,
): boolean {
  const normalizedRelease = releaseTitle
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ");

  // Year check: if release title contains a year and it doesn't match, reject.
  if (mediaYear) {
    const yearMatch = normalizedRelease.match(/\b((?:19|20)\d{2})\b/);
    if (yearMatch && parseInt(yearMatch[1], 10) !== mediaYear) return true;
  }

  // Title check: distinctive words (≥3 chars, not stop words) from the expected
  // title must appear in the release title. Require 70% match.
  const titleWords = mediaTitle
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  if (titleWords.length === 0) return false; // title too short to judge

  const matchCount = titleWords.filter((w) =>
    normalizedRelease.includes(w),
  ).length;
  return matchCount < Math.ceil(titleWords.length * 0.7);
}

/**
 * Filter and sort a list of interactive release items.
 */
export function filterAndSortReleases(
  rawReleases: InteractiveReleaseItem[],
  params: FilterParams,
): InteractiveReleaseItem[] {
  const {
    filterQuery,
    hideRejected,
    includedTrackers,
    excludedTrackers,
    includedLanguages,
    sortBy,
    sortDir,
    isSearchMode = false,
    mediaTitle,
    mediaYear,
  } = params;

  const includeTrackers = new Set(includedTrackers);
  const excludeTrackers = new Set(excludedTrackers);
  const includeLanguages = new Set(includedLanguages);
  const normalizedQuery = normalizeFilterKey(filterQuery);

  const filtered = rawReleases.filter((release) => {
    if (hideRejected) {
      if (release.rejected) return false;
      // Prowlarr results have no arr-side rejection — apply client-side title/year matching.
      if (isSearchMode && mediaTitle) {
        if (isClientRejected(release.title, mediaTitle, mediaYear))
          return false;
      }
    }

    const trackerKey = release.indexer?.trim()
      ? normalizeFilterKey(release.indexer)
      : UNKNOWN_TRACKER_KEY;
    if (includeTrackers.size > 0 && !includeTrackers.has(trackerKey))
      return false;
    if (excludeTrackers.has(trackerKey)) return false;

    if (includeLanguages.size > 0) {
      const releaseLanguageKeys =
        release.languages.length > 0
          ? release.languages.map((language) => normalizeFilterKey(language))
          : [UNKNOWN_LANGUAGE_KEY];

      if (
        !releaseLanguageKeys.some((languageKey) =>
          includeLanguages.has(languageKey),
        )
      )
        return false;
    }

    if (normalizedQuery) {
      const searchableValue = `${release.title} ${release.indexer ?? ""}`;
      if (!normalizeFilterKey(searchableValue).includes(normalizedQuery))
        return false;
    }

    return true;
  });

  return [...filtered].sort((a, b) => {
    if (sortBy === "quality") {
      if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
      const as = a.quality_score ?? -Number.MAX_SAFE_INTEGER;
      const bs = b.quality_score ?? -Number.MAX_SAFE_INTEGER;
      const c = sortDir === "desc" ? bs - as : as - bs;
      if (c !== 0) return c;
      return a.title.localeCompare(b.title);
    }

    let cmp: number;
    if (sortBy === "seeders") cmp = (a.seeders ?? -1) - (b.seeders ?? -1);
    else if (sortBy === "age")
      cmp =
        (a.age ?? Number.MAX_SAFE_INTEGER) - (b.age ?? Number.MAX_SAFE_INTEGER);
    else if (sortBy === "size")
      cmp = (a.size_bytes ?? -1) - (b.size_bytes ?? -1);
    else cmp = a.title.localeCompare(b.title);

    if (cmp === 0) return a.title.localeCompare(b.title);
    return sortDir === "asc" ? cmp : -cmp;
  });
}
