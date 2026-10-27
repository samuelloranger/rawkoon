import { access } from "node:fs/promises";
import type { LibraryHealthIssue } from "@rawkoon/shared";
import { prisma } from "@rawkoon/api/db";
import { collectEpisodeNumberMismatches } from "@rawkoon/api/services/libraryIntegrity/libraryIntegrityEpisodeCollectors";

const STALE_TMDB_STATUS_MS = 7 * 24 * 60 * 60 * 1000;
const FILE_CHECK_BATCH = 20;
/** Rows loaded per DB page for large-table scans */
const DB_PAGE_SIZE = 500;
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

/**
 * Books are gated on the feature flag rather than on row counts: a movies-only
 * install should neither pay for these scans nor be shown book rows it has no
 * pages for.
 */
async function booksEnabled(): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { booksEnabled: true },
  });
  return settings?.booksEnabled === true;
}

/**
 * An edition marked downloaded with no BookFile rows — the book analogue of
 * collectDownloadedMediaWithoutFiles. Usually means an import reported success
 * but wrote nothing, which the library UI cannot show on its own.
 */
export async function collectDownloadedBookEditionsWithoutFiles(): Promise<
  LibraryHealthIssue[]
> {
  if (!(await booksEnabled())) return [];

  const issues: LibraryHealthIssue[] = [];
  let cursor: { id: number } | undefined;

  for (;;) {
    const rows = await prisma.bookEdition.findMany({
      take: DB_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
      where: { status: "downloaded" },
      select: {
        id: true,
        kind: true,
        book: { select: { id: true, title: true } },
        _count: { select: { files: true } },
      },
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (row._count.files === 0) {
        issues.push({
          kind: "downloaded_book_edition_without_files",
          book_id: row.book.id,
          book_edition_id: row.id,
          edition_kind: row.kind,
          title: row.book.title,
          detail: `${row.kind} "${row.book.title}" is downloaded but has no BookFile records.`,
        });
      }
    }

    cursor = { id: rows[rows.length - 1]!.id };
  }

  return issues;
}

/** BookFile rows whose path has vanished from disk. */
export async function collectMissingBookFilePaths(): Promise<
  LibraryHealthIssue[]
> {
  if (!(await booksEnabled())) return [];

  const missing: LibraryHealthIssue[] = [];
  let cursor: { id: number } | undefined;

  for (;;) {
    const files = await prisma.bookFile.findMany({
      take: DB_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
      select: {
        id: true,
        filePath: true,
        edition: {
          select: {
            id: true,
            kind: true,
            book: { select: { id: true, title: true } },
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
            kind: "missing_book_file_path",
            book_id: file.edition.book.id,
            book_edition_id: file.edition.id,
            book_file_id: file.id,
            edition_kind: file.edition.kind,
            title: file.edition.book.title,
            path: file.filePath,
            detail: `BookFile ${file.id} points to a missing path: ${file.filePath}`,
          });
        }
      }
    }

    cursor = { id: files[files.length - 1]!.id };
  }

  return missing;
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
    downloadedBookEditionsWithoutFiles,
    missingBookFilePaths,
  ] = await Promise.all([
    collectDownloadedMediaWithoutFiles(),
    collectDownloadedEpisodesWithoutFiles(),
    collectMissingFilePaths(),
    collectStaleTmdbStatuses(),
    collectEpisodeNumberMismatches(warnings),
    collectDownloadedBookEditionsWithoutFiles(),
    collectMissingBookFilePaths(),
  ]);

  return {
    issues: [
      ...downloadedMediaWithoutFiles,
      ...downloadedEpisodesWithoutFiles,
      ...missingFilePaths,
      ...staleTmdbStatuses,
      ...episodeNumberMismatches,
      ...downloadedBookEditionsWithoutFiles,
      ...missingBookFilePaths,
    ],
    warnings,
  };
}
