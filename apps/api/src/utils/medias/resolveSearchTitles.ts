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
