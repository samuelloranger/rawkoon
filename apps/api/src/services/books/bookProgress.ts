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
 */
export const saveProgress = async (
  userId: string,
  editionId: number,
  body: BookProgressWrite,
): Promise<{ progress: BookProgress; accepted: boolean }> => {
  const clientUpdatedAt = new Date(body.client_updated_at);

  const existing = await prisma.bookProgress.findUnique({
    where: { userId_editionId: { userId, editionId } },
    select: progressSelect,
  });

  if (
    existing &&
    existing.clientUpdatedAt.getTime() >= clientUpdatedAt.getTime()
  ) {
    return { progress: mapProgress(existing), accepted: false };
  }

  const data = {
    locator: body.locator ?? null,
    percent: body.percent ?? null,
    positionSecs: body.position_secs ?? null,
    fileId: body.file_id ?? null,
    finishedAt: body.finished ? new Date() : null,
    clientUpdatedAt,
  };

  const row = await prisma.bookProgress.upsert({
    where: { userId_editionId: { userId, editionId } },
    create: { userId, editionId, ...data },
    update: data,
    select: progressSelect,
  });

  return { progress: mapProgress(row), accepted: true };
};
