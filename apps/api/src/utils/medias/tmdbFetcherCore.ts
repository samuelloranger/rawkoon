import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeTmdbConfig } from "@rawkoon/api/utils/integrations/normalizers";

/**
 * Supported i18n locale → TMDB language tag mappings.
 * Only locales actively used in the app are listed here; all others fall back
 * to the base language tag (e.g. "fr-CA" → "fr-FR") and then to "en-US".
 * Add entries here when new UI languages are introduced.
 */
const LOCALE_TO_TMDB: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
};

/** Maps an i18n locale or TMDB-style tag to a TMDB `language` query value. */
export function toTmdbLanguage(locale: string): string {
  return (
    LOCALE_TO_TMDB[locale] ?? LOCALE_TO_TMDB[locale.split("-")[0]] ?? "en-US"
  );
}

export async function loadTmdbConfig() {
  const integration = await getIntegrationConfigRecord("tmdb");
  return integration?.enabled ? normalizeTmdbConfig(integration.config) : null;
}

export function makeTmdbFetch(apiKey: string, language = "en-US") {
  return async (
    path: string,
    extraParams?: Record<string, string | undefined>,
  ): Promise<Record<string, unknown> | null> => {
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("language", language);
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v != null && v !== "") url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return res.json() as Promise<Record<string, unknown>>;
  };
}
