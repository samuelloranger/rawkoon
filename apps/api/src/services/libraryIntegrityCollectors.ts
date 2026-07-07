import { access } from "node:fs/promises";
import type { LibraryHealthIssue } from "@rawkoon/shared";
import { prisma } from "@rawkoon/api/db";
import {
  getLibraryTmdbApiKey,
  tmdbApiFetch,
} from "@rawkoon/api/utils/medias/libraryHelpers";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";

const STALE_TMDB_STATUS_MS = 7 * 24 * 60 * 60 * 1000;
const TMDB_REQUEST_DELAY_MS = 250;
const FILE_CHECK_BATCH = 20;
/** Rows loaded per DB page for large-table scans */
const DB_PAGE_SIZE = 500;
/** Shows processed per TMDB episode drift batch (limits memory vs loading all shows at once) */
const SHOW_TMDB_PAGE_SIZE = 25;

type TmdbEpisode = {
  id: number;
  episode_number: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectDownloadedMediaWithoutFiles(): Promise<
  LibraryHealthIssue[]
> {
  const issues: LibraryHealthIssue[] = [];
  let cursor: { id: number } | undefined;

  for (;;) {
    const rows = await prisma.libraryMedia.findMany({
      take: DB_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
      where: { status: "downloaded" },
      select: {
        id: true,
        tmdbId: true,
        type: true,
        title: true,
        _count: { select: { files: true } },
      },
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (row._count.files === 0) {
        issues.push({
          kind: "downloaded_media_without_files",
          media_id: row.id,
          tmdb_id: row.tmdbId,
          title: row.title,
          media_type: row.type,
          detail: `${row.type} "${row.title}" is downloaded but has no MediaFile records.`,
        });
      }
    }

    cursor = { id: rows[rows.length - 1]!.id };
  }

  return issues;
}

async function collectDownloadedEpisodesWithoutFiles(): Promise<
  LibraryHealthIssue[]
> {
  const issues: LibraryHealthIssue[] = [];
  let cursor: { id: number } | undefined;

  for (;;) {
    const rows = await prisma.libraryEpisode.findMany({
      take: DB_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
      where: { status: "downloaded" },
      select: {
        id: true,
        season: true,
        episode: true,
        tmdbEpisodeId: true,
        media: { select: { id: true, tmdbId: true, title: true } },
        _count: { select: { files: true } },
      },
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (row._count.files === 0) {
        issues.push({
          kind: "downloaded_episode_without_files",
          media_id: row.media.id,
          episode_id: row.id,
          tmdb_id: row.media.tmdbId,
          tmdb_episode_id: row.tmdbEpisodeId ?? undefined,
          title: row.media.title,
          media_type: "show",
          season: row.season,
          episode: row.episode,
          detail: `"${row.media.title}" S${row.season}E${row.episode} is downloaded but has no MediaFile records.`,
        });
      }
    }

    cursor = { id: rows[rows.length - 1]!.id };
  }

  return issues;
}

async function collectMissingFilePaths(): Promise<LibraryHealthIssue[]> {
  const missing: LibraryHealthIssue[] = [];
  let cursor: { id: number } | undefined;

  for (;;) {
    const files = await prisma.mediaFile.findMany({
      take: DB_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
      select: {
        id: true,
        filePath: true,
        media: { select: { id: true, tmdbId: true, title: true, type: true } },
        episode: {
          select: {
            id: true,
            season: true,
            episode: true,
            tmdbEpisodeId: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });

    if (files.length === 0) break;

    for (let i = 0; i < files.length; i += FILE_CHECK_BATCH) {
      const batch = files.slice(i, i + FILE_CHECK_BATCH);
      const results = await Promise.all(
        batch.map(async (file) => ({
          file,
          exists: await fileExists(file.filePath),
        })),
      );
      for (const { file, exists } of results) {
        if (!exists) {
          missing.push({
            kind: "missing_file_path",
            media_id: file.media?.id,
            episode_id: file.episode?.id,
            media_file_id: file.id,
            tmdb_id: file.media?.tmdbId,
            tmdb_episode_id: file.episode?.tmdbEpisodeId ?? undefined,
            title: file.media?.title,
            media_type: file.media?.type,
            season: file.episode?.season,
            episode: file.episode?.episode,
            path: file.filePath,
            detail: `MediaFile ${file.id} points to a missing path: ${file.filePath}`,
          });
        }
      }
    }

    cursor = { id: files[files.length - 1]!.id };
  }

  return missing;
}

async function collectStaleTmdbStatuses(): Promise<LibraryHealthIssue[]> {
  const cutoff = new Date(Date.now() - STALE_TMDB_STATUS_MS);
  const issues: LibraryHealthIssue[] = [];
  let cursor: { id: number } | undefined;

  for (;;) {
    const rows = await prisma.libraryMedia.findMany({
      take: DB_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
      where: {
        type: "show",
        OR: [
          { tmdbStatusRefreshedAt: null },
          { tmdbStatusRefreshedAt: { lt: cutoff } },
        ],
      },
      select: {
        id: true,
        tmdbId: true,
        title: true,
        type: true,
        tmdbStatus: true,
        tmdbStatusRefreshedAt: true,
      },
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      issues.push({
        kind: "stale_tmdb_status",
        media_id: row.id,
        tmdb_id: row.tmdbId,
        title: row.title,
        media_type: row.type,
        tmdb_status: row.tmdbStatus,
        tmdb_status_refreshed_at:
          row.tmdbStatusRefreshedAt?.toISOString() ?? null,
        detail: `"${row.title}" TMDB status has not been refreshed in more than 7 days.`,
      });
    }

    cursor = { id: rows[rows.length - 1]!.id };
  }

  return issues;
}

async function collectEpisodeNumberMismatches(
  warnings: string[],
): Promise<LibraryHealthIssue[]> {
  const apiKey = await getLibraryTmdbApiKey();
  if (!apiKey) {
    warnings.push(
      "TMDB integration is disabled or missing an API key; episode mismatch checks were skipped.",
    );
    return [];
  }

  const issues: LibraryHealthIssue[] = [];
  let cursor: { id: number } | undefined;

  for (;;) {
    const shows = await prisma.libraryMedia.findMany({
      take: SHOW_TMDB_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
      where: { type: "show" },
      select: {
        id: true,
        tmdbId: true,
        title: true,
        episodes: {
          select: {
            id: true,
            season: true,
            episode: true,
            tmdbEpisodeId: true,
          },
          orderBy: [{ season: "asc" }, { episode: "asc" }],
        },
      },
      orderBy: { id: "asc" },
    });

    if (shows.length === 0) break;

    for (const show of shows) {
      try {
        const details = await tmdbApiFetch<{
          seasons: Array<{ season_number: number }>;
        }>(`tv/${show.tmdbId}`, apiKey, {
          language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
        });

        const tmdbEpisodesById = new Map<
          number,
          { season: number; episode: number }
        >();
        const tmdbEpisodesByNumber = new Set<string>();

        for (const season of details.seasons.filter(
          (s) => s.season_number > 0,
        )) {
          await sleep(TMDB_REQUEST_DELAY_MS);
          const seasonData = await tmdbApiFetch<{ episodes: TmdbEpisode[] }>(
            `tv/${show.tmdbId}/season/${season.season_number}`,
            apiKey,
            { language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE },
          );

          for (const episode of seasonData.episodes) {
            tmdbEpisodesById.set(episode.id, {
              season: season.season_number,
              episode: episode.episode_number,
            });
            tmdbEpisodesByNumber.add(
              `${season.season_number}:${episode.episode_number}`,
            );
          }
        }

        for (const episode of show.episodes) {
          const localKey = `${episode.season}:${episode.episode}`;
          const expected = episode.tmdbEpisodeId
            ? tmdbEpisodesById.get(episode.tmdbEpisodeId)
            : null;

          if (expected) {
            if (
              expected.season !== episode.season ||
              expected.episode !== episode.episode
            ) {
              issues.push({
                kind: "episode_number_mismatch",
                media_id: show.id,
                episode_id: episode.id,
                tmdb_id: show.tmdbId,
                tmdb_episode_id: episode.tmdbEpisodeId ?? undefined,
                title: show.title,
                media_type: "show",
                season: episode.season,
                episode: episode.episode,
                expected_season: expected.season,
                expected_episode: expected.episode,
                detail: `"${show.title}" S${episode.season}E${episode.episode} maps to TMDB S${expected.season}E${expected.episode}.`,
              });
            }
          } else if (
            episode.tmdbEpisodeId !== null &&
            !tmdbEpisodesByNumber.has(localKey)
          ) {
            issues.push({
              kind: "episode_number_mismatch",
              media_id: show.id,
              episode_id: episode.id,
              tmdb_id: show.tmdbId,
              tmdb_episode_id: episode.tmdbEpisodeId ?? undefined,
              title: show.title,
              media_type: "show",
              season: episode.season,
              episode: episode.episode,
              detail: `"${show.title}" S${episode.season}E${episode.episode} was not found in TMDB.`,
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Episode mismatch check failed for "${show.title}" (${show.id}): ${message}`,
        );
      }

      await sleep(TMDB_REQUEST_DELAY_MS);
    }

    cursor = { id: shows[shows.length - 1]!.id };
  }

  return issues;
}

export async function collectLibraryIntegrityIssues(): Promise<{
  issues: LibraryHealthIssue[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const [
    downloadedMediaWithoutFiles,
    downloadedEpisodesWithoutFiles,
    missingFilePaths,
    staleTmdbStatuses,
    episodeNumberMismatches,
  ] = await Promise.all([
    collectDownloadedMediaWithoutFiles(),
    collectDownloadedEpisodesWithoutFiles(),
    collectMissingFilePaths(),
    collectStaleTmdbStatuses(),
    collectEpisodeNumberMismatches(warnings),
  ]);

  return {
    issues: [
      ...downloadedMediaWithoutFiles,
      ...downloadedEpisodesWithoutFiles,
      ...missingFilePaths,
      ...staleTmdbStatuses,
      ...episodeNumberMismatches,
    ],
    warnings,
  };
}
