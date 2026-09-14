import { SUPPORTED_TITLE_LANGUAGES } from "@rawkoon/shared/constants";
import { prisma } from "@rawkoon/api/db";
import {
  resolveLocalizedTitleRows,
  type LocalizedTitleInput,
} from "@rawkoon/api/utils/medias/localizedTitles";

/**
 * Upsert the per-locale title rows for one media.
 * Never throws — a failure here must not lose a library add.
 */
export async function writeLocalizedTitles(
  mediaId: number,
  input: LocalizedTitleInput,
): Promise<void> {
  try {
    const rows = resolveLocalizedTitleRows(input);
    for (const row of rows) {
      await prisma.libraryMediaTitle.upsert({
        where: {
          mediaId_language: { mediaId, language: row.language },
        },
        create: {
          mediaId,
          language: row.language,
          title: row.title,
          sortTitle: row.sortTitle,
        },
        update: { title: row.title, sortTitle: row.sortTitle },
      });
    }
  } catch (e) {
    console.warn(
      `[localizedTitleSync] Failed to write title rows for media ${mediaId}:`,
      e,
    );
  }
}

/**
 * Media whose title rows are missing or predate the media's last update.
 * Ordered by id so repeated runs make forward progress.
 */
export async function findMediaNeedingLocalizedTitles(
  limit: number,
): Promise<{ id: number; tmdbId: number; type: string }[]> {
  return prisma.$queryRaw<{ id: number; tmdbId: number; type: string }[]>`
    SELECT m.id, m.tmdb_id AS "tmdbId", m.type
    FROM library_media m
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n, MIN(t.updated_at) AS oldest
      FROM library_media_titles t
      WHERE t.media_id = m.id
    ) s ON TRUE
    WHERE s.n < ${SUPPORTED_TITLE_LANGUAGES.length}
       OR s.oldest < m.updated_at
    ORDER BY m.id
    LIMIT ${limit}
  `;
}
