import { prisma } from "@rawkoon/api/db";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";
import {
  getLibraryTmdbApiKey,
  pickDigitalRelease,
  resolveDownloadedStatus,
  tmdbApiFetch,
  upsertLibraryShowEpisodesFromTmdb,
} from "@rawkoon/api/utils/medias/libraryHelpers";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";

/** Fetch TMDB digital release and persist on library row. Returns new value (or null). */
export async function refreshLibraryMovieDigitalDate(
  mediaId: number,
): Promise<Date | null> {
  const key = await getLibraryTmdbApiKey();
  if (!key) return null;

  const m = await prisma.libraryMedia.findUnique({ where: { id: mediaId } });
  if (!m || m.type !== "movie") return null;
  const region = await getGlobalTmdbRegion();

  const releaseDatesData = await tmdbApiFetch<{
    results: Array<{
      iso_3166_1: string;
      release_dates: Array<{ type: number; release_date: string }>;
    }>;
  }>(`movie/${m.tmdbId}/release_dates`, key, {
    language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
  });

  const picked = pickDigitalRelease(releaseDatesData.results, region);
  await prisma.libraryMedia.update({
    where: { id: mediaId },
    data: { digitalReleaseDate: picked },
  });
  return picked;
}

/** Re-sync season/episode list from TMDB for a show (matches POST /api/library show upsert). */
export async function syncLibraryShowEpisodes(mediaId: number): Promise<void> {
  const key = await getLibraryTmdbApiKey();
  if (!key) return;

  const media = await prisma.libraryMedia.findUnique({
    where: { id: mediaId },
  });
  if (!media || media.type !== "show") return;

  const details = await tmdbApiFetch<{ status: string | null }>(
    `tv/${media.tmdbId}`,
    key,
    { language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE },
  );
  const newTmdbStatus = details.status ?? null;
  const PRODUCTION_STATUSES = [
    "returning",
    "in_production",
    "planned",
    "downloaded",
  ];
  await prisma.libraryMedia.update({
    where: { id: mediaId },
    data: {
      tmdbStatus: newTmdbStatus,
      ...(PRODUCTION_STATUSES.includes(media.status)
        ? { status: resolveDownloadedStatus("show", newTmdbStatus) }
        : {}),
    },
  });
  await prisma.$executeRaw`
    UPDATE "library_media"
    SET "tmdb_status_refreshed_at" = NOW()
    WHERE "id" = ${mediaId}
  `;

  await upsertLibraryShowEpisodesFromTmdb({
    mediaId: media.id,
    tmdbShowId: media.tmdbId,
    apiKey: key,
    languageParams: { language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE },
  });
}
