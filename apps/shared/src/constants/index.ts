/** Locales the web app ships translations for; the set of stored title languages. */
export const SUPPORTED_TITLE_LANGUAGES = ["en", "fr"] as const;

export type TitleLanguage = (typeof SUPPORTED_TITLE_LANGUAGES)[number];

export const DEFAULT_TITLE_LANGUAGE: TitleLanguage = "en";

/** Narrow an i18n tag ("fr-CA", "EN") to a stored title language, else the default. */
export function normalizeTitleLanguage(
  value: string | null | undefined,
): TitleLanguage {
  const base = (value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_TITLE_LANGUAGES.includes(base as TitleLanguage)
    ? (base as TitleLanguage)
    : DEFAULT_TITLE_LANGUAGE;
}
