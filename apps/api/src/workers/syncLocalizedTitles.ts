import {
  findMediaNeedingLocalizedTitles,
  writeLocalizedTitles,
} from "@rawkoon/api/services/localizedTitleSync";
import {
  getLibraryTmdbApiKey,
  tmdbApiFetch,
} from "@rawkoon/api/utils/medias/libraryHelpers";
import { extractTitleTranslations } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";
import { toStringOrNull } from "@rawkoon/api/utils/medias/mappers";

const BATCH_LIMIT = 200;
const TMDB_REQUEST_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type TmdbTitleDetails = {
  title?: string;
  name?: string;
  original_title?: string | null;
  original_name?: string | null;
  original_language?: string | null;
  translations?: unknown;
};

/**
 * Fill or refresh per-locale title rows for media the selector flags. This is
 * what covers the add paths that create media without TMDB translations
 * (library scan, Radarr/Sonarr migration, the refresh script), and what heals
 * a stale row after a TMDB retitle.
 */
export async function syncLocalizedTitles(
  limit = BATCH_LIMIT,
): Promise<{ processed: number; failed: number }> {
  const key = await getLibraryTmdbApiKey();
  if (!key) return { processed: 0, failed: 0 };

  const media = await findMediaNeedingLocalizedTitles(limit);
  let processed = 0;
  let failed = 0;

  for (const m of media) {
    const isMovie = m.type === "movie";
    try {
      const details = await tmdbApiFetch<TmdbTitleDetails>(
        `${isMovie ? "movie" : "tv"}/${m.tmdbId}`,
        key,
        {
          language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
          append_to_response: "translations",
        },
      );
      const englishTitle = (isMovie ? details.title : details.name) ?? "";
      if (!englishTitle) {
        failed++;
        continue;
      }
      await writeLocalizedTitles(m.id, {
        englishTitle,
        originalTitle: toStringOrNull(
          isMovie ? details.original_title : details.original_name,
        ),
        originalLanguage: toStringOrNull(details.original_language),
        translations: extractTitleTranslations(
          details.translations,
          isMovie ? "movie" : "tv",
        ),
      });
      processed++;
    } catch (e) {
      console.warn(
        `[syncLocalizedTitles] media ${m.id} (tmdb ${m.tmdbId}) failed:`,
        e,
      );
      failed++;
    }
    await sleep(TMDB_REQUEST_DELAY_MS);
  }

  return { processed, failed };
}
