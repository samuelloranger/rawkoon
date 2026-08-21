import { prisma } from "@rawkoon/api/db";
import type { BookProgress, BookProgressWrite } from "@rawkoon/shared/types";

type ProgressRow = {
  editionId: number;
  locator: string | null;
  percent: number | null;
  positionSecs: number | null;
  fileId: number | null;
  finishedAt: Date | null;
  clientUpdatedAt: Date;
  updatedAt: Date;
};

export const mapProgress = (row: ProgressRow): BookProgress => ({
  edition_id: row.editionId,
  locator: row.locator,
  percent: row.percent,
  position_secs: row.positionSecs,
  file_id: row.fileId,
  finished_at: row.finishedAt?.toISOString() ?? null,
  client_updated_at: row.clientUpdatedAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

/** `$queryRaw` returns database column names, not Prisma's camelCase. */
type RawProgressRow = {
  edition_id: number;
  locator: string | null;
  percent: number | null;
  position_secs: number | null;
  file_id: number | null;
  finished_at: Date | null;
  client_updated_at: Date;
  updated_at: Date;
};

const mapRawProgress = (row: RawProgressRow): BookProgress => ({
  edition_id: row.edition_id,
  locator: row.locator,
  percent: row.percent,
  position_secs: row.position_secs,
  file_id: row.file_id,
  finished_at: row.finished_at?.toISOString() ?? null,
  client_updated_at: row.client_updated_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

const progressSelect = {
  editionId: true,
  locator: true,
  percent: true,
  positionSecs: true,
  fileId: true,
  finishedAt: true,
  clientUpdatedAt: true,
  updatedAt: true,
} as const;

export const getProgress = async (
  userId: string,
  editionId: number,
): Promise<BookProgress | null> => {
  const row = await prisma.bookProgress.findUnique({
    where: { userId_editionId: { userId, editionId } },
    select: progressSelect,
  });
  return row ? mapProgress(row) : null;
};

export const listProgress = async (
  userId: string,
  editionIds: number[],
): Promise<BookProgress[]> => {
  if (editionIds.length === 0) return [];
  const rows = await prisma.bookProgress.findMany({
    where: { userId, editionId: { in: editionIds } },
    select: progressSelect,
  });
  return rows.map(mapProgress);
};

/**
 * Upsert a position, newest client clock wins.
 *
 * The rule exists for offline clients: a phone that queued writes for a week
 * must not rewind a position set later on another device. A write whose
 * `client_updated_at` does not beat the stored one is rejected and the stored
 * row comes back instead, so the loser can reconcile without a prompt. Equal
 * timestamps keep the stored row — a tie is not new information.
 *
 * It is one statement on purpose. A read-then-write pair lets two devices saving
 * at the same moment both observe the same old row, after which the older write
 * can land last and rewind the newer position — exactly the failure the rule is
 * meant to prevent. Postgres evaluates the predicate while holding the row, so
 * the loser updates nothing and returns no row.
 */
export const saveProgress = async (
  userId: string,
  editionId: number,
  body: BookProgressWrite,
): Promise<{ progress: BookProgress; accepted: boolean }> => {
  const clientUpdatedAt = new Date(body.client_updated_at);

  const written = await prisma.$queryRaw<RawProgressRow[]>`
    INSERT INTO book_progress (
      user_id, edition_id, locator, percent, position_secs, file_id,
      finished_at, client_updated_at, updated_at
    )
    VALUES (
      ${userId}, ${editionId}, ${body.locator ?? null},
      ${body.percent ?? null}, ${body.position_secs ?? null},
      ${body.file_id ?? null},
      ${body.finished ? new Date() : null}, ${clientUpdatedAt}, NOW()
    )
    ON CONFLICT (user_id, edition_id) DO UPDATE SET
      locator = EXCLUDED.locator,
      percent = EXCLUDED.percent,
      position_secs = EXCLUDED.position_secs,
      file_id = EXCLUDED.file_id,
      finished_at = EXCLUDED.finished_at,
      client_updated_at = EXCLUDED.client_updated_at,
      updated_at = NOW()
    WHERE book_progress.client_updated_at < EXCLUDED.client_updated_at
    RETURNING
      edition_id, locator, percent, position_secs, file_id,
      finished_at, client_updated_at, updated_at
  `;

  const row = written[0];
  if (row) return { progress: mapRawProgress(row), accepted: true };

  // No row came back: the predicate refused the update, so the stored position
  // is the newer one. Reading it now is safe — the winner has already committed.
  const stored = await getProgress(userId, editionId);
  return stored
    ? { progress: stored, accepted: false }
    : // Unreachable in practice: nothing but a losing conflict returns no row,
      // and a conflict means a row exists. Falling back to the client's own
      // values keeps the response shaped correctly if it ever happens.
      {
        progress: {
          edition_id: editionId,
          locator: body.locator ?? null,
          percent: body.percent ?? null,
          position_secs: body.position_secs ?? null,
          file_id: body.file_id ?? null,
          finished_at: null,
          client_updated_at: clientUpdatedAt.toISOString(),
          updated_at: clientUpdatedAt.toISOString(),
        },
        accepted: false,
      };
};

/**
 * Mark an edition finished, keeping whatever position the server holds.
 *
 * The position is deliberately not sent by the client. A client that fetched
 * the row a minute ago holds a snapshot, and resending that snapshot under a
 * fresh timestamp would make it win the newest-clock rule — rewinding a
 * position another device had advanced in the meantime. `DO UPDATE` touching
 * only the finished columns cannot: the stored locator and seconds stay exactly
 * as they are.
 *
 * The clock is the server's, which is what makes this beat writes still queued
 * on an offline device. A client whose clock runs ahead of the server can still
 * out-stamp it; that is the same trade the rest of the progress path makes, and
 * the cost is one re-finish rather than a lost position.
 */
export const finishProgress = async (
  userId: string,
  editionId: number,
): Promise<BookProgress> => {
  const rows = await prisma.$queryRaw<RawProgressRow[]>`
    INSERT INTO book_progress (
      user_id, edition_id, locator, percent, position_secs, file_id,
      finished_at, client_updated_at, updated_at
    )
    VALUES (${userId}, ${editionId}, NULL, 1, NULL, NULL, NOW(), NOW(), NOW())
    ON CONFLICT (user_id, edition_id) DO UPDATE SET
      finished_at = NOW(),
      client_updated_at = NOW(),
      updated_at = NOW()
    RETURNING
      edition_id, locator, percent, position_secs, file_id,
      finished_at, client_updated_at, updated_at
  `;
  return mapRawProgress(rows[0]);
};

/**
 * Put an edition back at its beginning.
 *
 * A delete would be the obvious implementation and the wrong one: the row would
 * be recreated by any write still queued on a device that has been offline. An
 * update stamped with the server clock survives that flush.
 */
export const resetProgress = async (
  userId: string,
  editionId: number,
): Promise<BookProgress> => {
  const rows = await prisma.$queryRaw<RawProgressRow[]>`
    INSERT INTO book_progress (
      user_id, edition_id, locator, percent, position_secs, file_id,
      finished_at, client_updated_at, updated_at
    )
    VALUES (${userId}, ${editionId}, NULL, 0, 0, NULL, NULL, NOW(), NOW())
    ON CONFLICT (user_id, edition_id) DO UPDATE SET
      locator = NULL,
      percent = 0,
      position_secs = 0,
      file_id = NULL,
      finished_at = NULL,
      client_updated_at = NOW(),
      updated_at = NOW()
    RETURNING
      edition_id, locator, percent, position_secs, file_id,
      finished_at, client_updated_at, updated_at
  `;
  return mapRawProgress(rows[0]);
};
