import type { InteractiveReleaseItem } from "@rawkoon/shared/types";
import { isFrenchFallbackTag } from "@rawkoon/shared/utils/languageFamily";

export const INTERACTIVE_SORT_KEYS = [
  "quality",
  "seeders",
  "age",
  "size",
  "title",
] as const;
export type InteractiveSortKey = (typeof INTERACTIVE_SORT_KEYS)[number];
export type InteractiveSortDir = "asc" | "desc";

export const UNKNOWN_TRACKER_KEY = "__unknown_tracker__";
export const UNKNOWN_LANGUAGE_KEY = "__unknown_language__";

export interface TitleOption {
  /** ISO 639-1 code */
  languageCode: string;
  /** Full search query (title plus any season/episode suffix) */
  query: string;
  /** True when this language is the media's original language */
  isOriginal: boolean;
}

/** A title option enriched with a display label, ready to render in the picker. */
export interface LabeledTitleOption extends TitleOption {
  label: string;
}

/** Extra picker languages offered when TMDB has a title for them. */
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

/** Ordered, query-deduped title options; `localizedLanguage` must be the language `localized` is written in, NOT the UI language, since library titles are persisted in English. */
export function buildTitleOptions(input: {
  localized: string;
  /** ISO 639-1 code of the language `localized` is written in */
  localizedLanguage: string;
  original?: string | null;
  originalLanguage?: string | null;
  translations?: { language_code: string; title: string }[];
  suffix?: string;
}): TitleOption[] {
  const suffix = input.suffix ?? "";
  const platform = (input.localizedLanguage || "").toLowerCase();
  const originalLanguage = (input.originalLanguage || "").toLowerCase();

  const translationByLang = new Map<string, string>();
  for (const entry of input.translations ?? []) {
    const code = entry.language_code?.toLowerCase();
    const title = entry.title?.trim();
    if (code && title && !translationByLang.has(code)) {
      translationByLang.set(code, title);
    }
  }

  // The English slot can hold any language's title, so detect the real language by matching against the original title and translations.
  const normalizeTitle = (value: string) => value.trim().toLocaleLowerCase();
  const localizedKey = normalizeTitle(input.localized || "");
  let detectedLanguage: string | null = null;
  if (localizedKey) {
    const originalKey = normalizeTitle(input.original ?? "");
    if (originalLanguage && originalKey && originalKey === localizedKey) {
      detectedLanguage = originalLanguage;
    } else {
      for (const [code, title] of translationByLang) {
        if (normalizeTitle(title) === localizedKey) {
          detectedLanguage = code;
          break;
        }
      }
    }
  }
  const platformLanguage =
    detectedLanguage && detectedLanguage !== platform
      ? detectedLanguage
      : platform;
  // The default is the original only when its real language is the original one.
  const localizedIsOriginal =
    platformLanguage !== platform && platformLanguage === originalLanguage;

  // Order: localized (default), EN/FR pinned, original (kept even if it shares the platform language), then the allowlist.
  type TitleCandidate = {
    languageCode: string;
    title: string | null;
    isOriginal: boolean;
    isPlatform: boolean;
  };

  // Skip pinned/common slots for languages already represented, so a less canonical translation doesn't sit beside the authoritative title.
  const coveredCodes = new Set(
    [platformLanguage, originalLanguage].filter(Boolean),
  );

  const candidates: TitleCandidate[] = [
    {
      languageCode: platformLanguage,
      title: input.localized,
      isOriginal: localizedIsOriginal,
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
    // Platform title always kept; secondary titles need 2+ chars to avoid noisy indexer queries.
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
  /** Expected title, for client-side rejection in Prowlarr mode */
  mediaTitle?: string | null;
  /** Expected year, for client-side rejection in Prowlarr mode */
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

/** Client-side Prowlarr rejection: year mismatch or too few distinctive title words. */
function isClientRejected(
  releaseTitle: string,
  mediaTitle: string,
  mediaYear?: number | null,
): boolean {
  const normalizedRelease = releaseTitle
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ");

  // Year check: if release title contains a year and it doesn't match, reject.
  if (mediaYear) {
    const yearMatch = normalizedRelease.match(/\b((?:19|20)\d{2})\b/);
    if (yearMatch && parseInt(yearMatch[1], 10) !== mediaYear) return true;
  }

  // Distinctive words (3+ chars, non-stop) of the expected title must match at 70%.
  const titleWords = mediaTitle
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  if (titleWords.length === 0) return false; // title too short to judge

  const matchCount = titleWords.filter((w) =>
    normalizedRelease.includes(w),
  ).length;
  return matchCount < Math.ceil(titleWords.length * 0.7);
}

/** Filter and sort a list of interactive release items. */
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
      // Language fallbacks are shown in their own group, not hidden.
      if (release.rejected && !release.language_fallback) return false;
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

export interface LanguageFallbackGroups {
  /** Releases for the main list. */
  primary: InteractiveReleaseItem[];
  /** Releases in another version of the preferred language, grabbable manually. */
  fallback: InteractiveReleaseItem[];
  /** Fallback releases per display tag, most common first. */
  counts: [tag: string, count: number][];
  /** "french" when every fallback release is a French version. */
  kind: "french" | "other";
}

/** Splits language-fallback releases out of a filtered list. */
export function splitLanguageFallback(
  releases: InteractiveReleaseItem[],
): LanguageFallbackGroups {
  const primary: InteractiveReleaseItem[] = [];
  const fallback: InteractiveReleaseItem[] = [];
  const tally = new Map<string, number>();
  for (const release of releases) {
    if (!release.language_fallback) {
      primary.push(release);
      continue;
    }
    fallback.push(release);
    const tag = release.language_fallback_tag ?? "?";
    tally.set(tag, (tally.get(tag) ?? 0) + 1);
  }
  const counts = [...tally.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const kind = counts.every(([tag]) => isFrenchFallbackTag(tag))
    ? "french"
    : "other";
  return { primary, fallback, counts, kind };
}
