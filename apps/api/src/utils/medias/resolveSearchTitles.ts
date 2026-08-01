import { normalizeTitleForMatch } from "@rawkoon/api/utils/medias/filenameParser";

/**
 * Resolves ordered indexer query titles and the match set for release filtering.
 * Legacy rows (null search/original) keep English-only `title` behavior.
 */
export function resolveSearchTitles(media: {
  title: string;
  searchTitle: string | null;
  originalTitle: string | null;
}): { queries: string[]; matchTitles: string[] } {
  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const t = raw?.trim();
    if (!t) return;
    const key = t.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(t);
  };

  if (media.searchTitle || media.originalTitle) {
    push(media.searchTitle);
    push(media.originalTitle);
  } else {
    push(media.title);
  }

  return { queries, matchTitles: [...queries] };
}

/**
 * Pick the denormalized preferred search title from a QP language + TMDB data.
 * Order: translation for language → original title when language matches → English.
 */
export function resolvePreferredSearchTitle(input: {
  englishTitle: string;
  preferredLanguage: string;
  originalTitle: string | null;
  originalLanguage: string | null;
  translations: { language_code: string; title: string }[];
}): { title: string; language: string } {
  const lang = (input.preferredLanguage || "en").toLowerCase();
  const byLang = new Map(
    input.translations.map((t) => [
      t.language_code.toLowerCase(),
      t.title.trim(),
    ]),
  );
  const fromTranslation = byLang.get(lang);
  if (fromTranslation) return { title: fromTranslation, language: lang };

  const origLang = (input.originalLanguage || "").toLowerCase();
  const origTitle = input.originalTitle?.trim();
  if (lang === origLang && origTitle) {
    return { title: origTitle, language: lang };
  }

  return { title: input.englishTitle, language: "en" };
}

/** True when a release title matches any expected media title (normalized). */
export function releaseMatchesExpectedTitles(
  releaseTitle: string,
  matchTitles: string[],
): boolean {
  if (matchTitles.length === 0) return true;
  const normalizedRelease = normalizeTitleForMatch(releaseTitle);
  return matchTitles.some((t) => {
    const expected = normalizeTitleForMatch(t);
    return (
      normalizedRelease === expected ||
      normalizedRelease.startsWith(`${expected} `)
    );
  });
}

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
 * Build the TMDB title option set used to validate per-media search title picks.
 * Mirrors web `buildTitleOptions` without season/episode suffix.
 */
export function buildSearchTitleOptions(input: {
  englishTitle: string;
  originalTitle?: string | null;
  originalLanguage?: string | null;
  translations?: { language_code: string; title: string }[];
}): { languageCode: string; title: string }[] {
  const platform = "en";
  const originalLanguage = (input.originalLanguage || "").toLowerCase();

  const translationByLang = new Map<string, string>();
  for (const entry of input.translations ?? []) {
    const code = entry.language_code?.toLowerCase();
    const title = entry.title?.trim();
    if (code && title && !translationByLang.has(code)) {
      translationByLang.set(code, title);
    }
  }

  type TitleCandidate = {
    languageCode: string;
    title: string | null;
    isPlatform: boolean;
  };

  const coveredCodes = new Set([platform, originalLanguage].filter(Boolean));
  const candidates: TitleCandidate[] = [
    {
      languageCode: platform,
      title: input.englishTitle,
      isPlatform: true,
    },
  ];
  for (const code of ["en", "fr"]) {
    if (!coveredCodes.has(code)) {
      candidates.push({
        languageCode: code,
        title: translationByLang.get(code) ?? null,
        isPlatform: false,
      });
    }
  }
  if (originalLanguage) {
    candidates.push({
      languageCode: originalLanguage,
      title:
        input.originalTitle?.trim() ||
        translationByLang.get(originalLanguage) ||
        null,
      isPlatform: false,
    });
  }
  for (const code of COMMON_TITLE_LANGUAGES) {
    if (!coveredCodes.has(code)) {
      candidates.push({
        languageCode: code,
        title: translationByLang.get(code) ?? null,
        isPlatform: false,
      });
    }
  }

  const options: { languageCode: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const base = candidate.title?.trim();
    const minLength = candidate.isPlatform ? 1 : 2;
    if (!base || base.length < minLength) continue;
    const dedupeKey = base.toLocaleLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    options.push({
      languageCode: candidate.languageCode,
      title: base,
    });
  }
  return options;
}
