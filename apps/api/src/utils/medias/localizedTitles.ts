import {
  SUPPORTED_TITLE_LANGUAGES,
  type TitleLanguage,
} from "@rawkoon/shared/constants";
import { sortTitleFromName } from "@rawkoon/api/utils/medias/libraryHelpers";

export type LocalizedTitleRow = {
  language: TitleLanguage;
  title: string;
  sortTitle: string;
};

export type LocalizedTitleInput = {
  englishTitle: string;
  originalTitle: string | null;
  originalLanguage: string | null;
  translations: { language_code: string; title: string }[];
};

/**
 * One title row per supported locale.
 * Order: translation for the locale → original title when it is that locale →
 * the English title. The last step guarantees every locale gets a row.
 */
export function resolveLocalizedTitleRows(
  input: LocalizedTitleInput,
): LocalizedTitleRow[] {
  const byLang = new Map<string, string>();
  for (const entry of input.translations) {
    const code = entry.language_code?.trim().toLowerCase();
    const title = entry.title?.trim();
    if (code && title && !byLang.has(code)) byLang.set(code, title);
  }

  const originalLanguage = (input.originalLanguage ?? "").trim().toLowerCase();
  const originalTitle = input.originalTitle?.trim() || null;
  const englishTitle = input.englishTitle.trim();

  return SUPPORTED_TITLE_LANGUAGES.map((language) => {
    const title =
      byLang.get(language) ??
      (language === originalLanguage && originalTitle
        ? originalTitle
        : englishTitle);
    return { language, title, sortTitle: sortTitleFromName(title, language) };
  });
}
