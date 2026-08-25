import type { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";
import { resolveDefaultQualityProfileId } from "@rawkoon/api/lib/defaultQualityProfile";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";
import {
  getLibraryTmdbApiKey,
  pickDigitalRelease,
  sortTitleFromName,
  tmdbApiFetch,
  upsertLibraryShowEpisodesFromTmdb,
} from "@rawkoon/api/utils/medias/libraryHelpers";
import { extractTitleTranslations } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";
import { resolvePreferredSearchTitle } from "@rawkoon/api/utils/medias/resolveSearchTitles";
import { DEFAULT_TMDB_REGION } from "@rawkoon/api/utils/medias/tmdbRegion";
import { toStringOrNull } from "@rawkoon/api/utils/medias/mappers";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

export const libraryMediaInclude = {
  qualityProfile: { select: { id: true, name: true } },
} as const;

export type LibraryMediaWithProfile = Prisma.LibraryMediaGetPayload<{
  include: typeof libraryMediaInclude;
}>;

type SearchTitleFields = {
  originalTitle: string | null;
  originalLanguage: string | null;
  searchTitle: string | null;
  searchTitleLanguage: string | null;
};

async function loadPreferredSearchLanguage(
  qualityProfileId: number | null,
): Promise<string | null> {
  if (qualityProfileId == null) return null;
  const row = await prisma.qualityProfile.findUnique({
    where: { id: qualityProfileId },
    select: { preferredSearchLanguage: true },
  });
  return row?.preferredSearchLanguage ?? null;
}

/**
 * Resolve create-only search title fields from TMDB details.
 * On failure returns nulls so the library add still succeeds (legacy path).
 */
function buildSearchTitleFields(opts: {
  englishTitle: string;
  preferredLanguage: string | null;
  originalTitle: string | null;
  originalLanguage: string | null;
  translationsRaw: unknown;
  mediaType: "movie" | "tv";
}): SearchTitleFields {
  try {
    const translations = extractTitleTranslations(
      opts.translationsRaw,
      opts.mediaType,
    );
    const preferred = resolvePreferredSearchTitle({
      englishTitle: opts.englishTitle,
      preferredLanguage: opts.preferredLanguage ?? "en",
      originalTitle: opts.originalTitle,
      originalLanguage: opts.originalLanguage,
      translations,
    });
    return {
      originalTitle: opts.originalTitle,
      originalLanguage: opts.originalLanguage,
      searchTitle: preferred.title,
      searchTitleLanguage: preferred.language,
    };
  } catch (e) {
    console.warn("[libraryFromTmdb] Failed to resolve search titles:", e);
    return {
      originalTitle: opts.originalTitle,
      originalLanguage: opts.originalLanguage,
      searchTitle: null,
      searchTitleLanguage: null,
    };
  }
}

/**
 * Upsert library media from TMDB (shared by POST /api/library and dashboard flows).
 * Titles, overviews, and episode names are always fetched in English for stable DB storage.
 */
export async function addOrUpdateLibraryFromTmdb(opts: {
  tmdb_id: number;
  type: "movie" | "show";
  region?: string;
  /** When set, used for search-title default and assigned on create. */
  qualityProfileId?: number | null;
}): Promise<NonNullable<LibraryMediaWithProfile>> {
  const key = await getLibraryTmdbApiKey();
  if (!key) throw new Error("TMDB is not configured");

  const mediaSettings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
  });
  const qualityProfileId =
    opts.qualityProfileId !== undefined
      ? opts.qualityProfileId
      : resolveDefaultQualityProfileId(opts.type, mediaSettings);
  const preferredSearchLanguage =
    await loadPreferredSearchLanguage(qualityProfileId);

  const { tmdb_id, type } = opts;
  const region = opts.region ?? DEFAULT_TMDB_REGION;
  const lang = {
    language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
    append_to_response: "translations",
  };

  if (type === "movie") {
    const [details, releaseDatesData] = await Promise.all([
      tmdbApiFetch<{
        title: string;
        release_date: string;
        poster_path: string | null;
        overview: string;
        original_title?: string | null;
        original_language?: string | null;
        translations?: unknown;
      }>(`movie/${tmdb_id}`, key, lang),
      tmdbApiFetch<{
        results: Array<{
          iso_3166_1: string;
          release_dates: Array<{ type: number; release_date: string }>;
        }>;
      }>(`movie/${tmdb_id}/release_dates`, key, {
        language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
      }),
    ]);

    const year = details.release_date
      ? parseInt(details.release_date.slice(0, 4), 10)
      : null;
    const posterUrl = details.poster_path
      ? `${TMDB_IMAGE_BASE}${details.poster_path}`
      : null;

    const existingMovie = await prisma.libraryMedia.findUnique({
      where: { tmdbId: tmdb_id },
      select: { overrides: true },
    });
    const movieOv = (existingMovie?.overrides ?? {}) as Record<string, unknown>;
    const movieLocked = (field: string) => field in movieOv;

    const searchFields = buildSearchTitleFields({
      englishTitle: details.title,
      preferredLanguage: preferredSearchLanguage,
      originalTitle: toStringOrNull(details.original_title),
      originalLanguage: toStringOrNull(details.original_language),
      translationsRaw: details.translations,
      mediaType: "movie",
    });

    return prisma.libraryMedia.upsert({
      where: { tmdbId: tmdb_id },
      create: {
        tmdbId: tmdb_id,
        type: "movie",
        title: details.title,
        sortTitle: sortTitleFromName(details.title),
        year,
        status: "wanted",
        posterUrl,
        overview: details.overview || null,
        digitalReleaseDate: pickDigitalRelease(
          releaseDatesData.results,
          region,
        ),
        ...searchFields,
        ...(qualityProfileId != null ? { qualityProfileId } : {}),
      },
      update: {
        ...(!movieLocked("title") ? { title: details.title } : {}),
        ...(!movieLocked("sort_title")
          ? { sortTitle: sortTitleFromName(details.title) }
          : {}),
        ...(!movieLocked("year") ? { year } : {}),
        ...(!movieLocked("poster_url") ? { posterUrl } : {}),
        ...(!movieLocked("overview")
          ? { overview: details.overview || null }
          : {}),
        digitalReleaseDate: pickDigitalRelease(
          releaseDatesData.results,
          region,
        ),
      },
      include: libraryMediaInclude,
    });
  }

  const details = await tmdbApiFetch<{
    name: string;
    first_air_date: string;
    poster_path: string | null;
    overview: string;
    status: string | null;
    seasons: Array<{ season_number: number; episode_count: number }>;
    original_name?: string | null;
    original_title?: string | null;
    original_language?: string | null;
    translations?: unknown;
  }>(`tv/${tmdb_id}`, key, lang);

  const year = details.first_air_date
    ? parseInt(details.first_air_date.slice(0, 4), 10)
    : null;
  const posterUrl = details.poster_path
    ? `${TMDB_IMAGE_BASE}${details.poster_path}`
    : null;

  const existingShow = await prisma.libraryMedia.findUnique({
    where: { tmdbId: tmdb_id },
    select: { overrides: true },
  });
  const showOv = (existingShow?.overrides ?? {}) as Record<string, unknown>;
  const showLocked = (field: string) => field in showOv;

  const searchFields = buildSearchTitleFields({
    englishTitle: details.name,
    preferredLanguage: preferredSearchLanguage,
    originalTitle: toStringOrNull(
      details.original_name ?? details.original_title,
    ),
    originalLanguage: toStringOrNull(details.original_language),
    translationsRaw: details.translations,
    mediaType: "tv",
  });

  const media = await prisma.libraryMedia.upsert({
    where: { tmdbId: tmdb_id },
    create: {
      tmdbId: tmdb_id,
      type: "show",
      title: details.name,
      sortTitle: sortTitleFromName(details.name),
      year,
      status: "wanted",
      tmdbStatus: details.status ?? null,
      posterUrl,
      overview: details.overview || null,
      ...searchFields,
      ...(qualityProfileId != null ? { qualityProfileId } : {}),
    },
    update: {
      ...(!showLocked("title") ? { title: details.name } : {}),
      ...(!showLocked("sort_title")
        ? { sortTitle: sortTitleFromName(details.name) }
        : {}),
      ...(!showLocked("year") ? { year } : {}),
      tmdbStatus: details.status ?? null,
      ...(!showLocked("poster_url") ? { posterUrl } : {}),
      ...(!showLocked("overview")
        ? { overview: details.overview || null }
        : {}),
    },
    include: libraryMediaInclude,
  });

  await prisma.$executeRaw`
    UPDATE "library_media"
    SET "tmdb_status_refreshed_at" = NOW()
    WHERE "id" = ${media.id}
      AND "type" = 'show'
  `;

  await upsertLibraryShowEpisodesFromTmdb({
    mediaId: media.id,
    tmdbShowId: tmdb_id,
    apiKey: key,
    languageParams: { language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE },
  });

  return media;
}
