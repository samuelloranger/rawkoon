import { prisma } from "@rawkoon/api/db";
import {
  AUTO_SYNC_DEVICE_ID,
  scheduleProgressSync,
} from "@rawkoon/api/services/books/progressAutoSync";
import { applyListeningCredit } from "@rawkoon/api/services/books/listeningStats";

const progressBookSelect = {
  edition: {
    select: {
      book: {
        select: { id: true, title: true, authors: true, coverUrl: true },
      },
    },
  },
} as const;

/**
 * A client timestamp is trusted backwards but not forwards.
 *
 * Last-write-wins uses the client `updated_at`, so a device clock set years in
 * the future would otherwise win every sync forever.
 */
export const clampClientTimestamp = (clientIso: string, now: Date): Date => {
  const parsed = new Date(clientIso);
  if (Number.isNaN(parsed.getTime())) return now;
  return parsed.getTime() > now.getTime() ? now : parsed;
};

export const findManifestEdition = (id: number) =>
  prisma.bookEdition.findUnique({
    where: { id },
    select: {
      id: true,
      offlineReady: true,
      book: {
        select: {
          id: true,
          title: true,
          authors: true,
        },
      },
      chapters: {
        orderBy: { index: "asc" },
        select: {
          index: true,
          title: true,
          startSecs: true,
          endSecs: true,
          bookFile: {
            select: {
              id: true,
              sizeBytes: true,
              sha256: true,
              filePath: true,
            },
          },
        },
      },
    },
  });

export const findBookFilePath = (id: number) =>
  prisma.bookFile.findUnique({
    where: { id },
    select: {
      filePath: true,
    },
  });

export const listListeningProgress = (userId: string) =>
  prisma.bookListeningProgress.findMany({
    where: { userId: userId },
    select: {
      editionId: true,
      positionSecs: true,
      totalDurationSecs: true,
      finished: true,
      updatedAt: true,
      ...progressBookSelect,
    },
    orderBy: { updatedAt: "desc" },
  });

export const listReadingProgress = (userId: string) =>
  prisma.bookReadingProgress.findMany({
    where: { userId: userId },
    select: {
      editionId: true,
      fileId: true,
      spineIndex: true,
      spinePath: true,
      spineCount: true,
      scrollFraction: true,
      locator: true,
      finished: true,
      updatedAt: true,
      ...progressBookSelect,
    },
    orderBy: { updatedAt: "desc" },
  });

const findEditionForProgress = (id: number) =>
  prisma.bookEdition.findUnique({
    where: { id },
    select: { id: true, bookId: true },
  });

type ListeningBody = {
  position_secs: number;
  total_duration_secs: number;
  finished?: boolean;
  updated_at: string;
  device_id?: string;
};

export type SaveListeningResult = "edition_not_found" | "stale" | "applied";

export async function saveListeningProgress(
  userId: string,
  editionId: number,
  body: ListeningBody,
): Promise<SaveListeningResult> {
  const edition = await findEditionForProgress(editionId);
  if (!edition) return "edition_not_found";

  const now = new Date();
  const updatedAt = clampClientTimestamp(body.updated_at, now);

  const existing = await prisma.bookListeningProgress.findUnique({
    where: {
      userId_editionId: { userId, editionId },
    },
    select: { updatedAt: true, positionSecs: true, receivedAt: true },
  });
  if (existing && existing.updatedAt > updatedAt) return "stale";

  const baseData = {
    positionSecs: body.position_secs,
    totalDurationSecs: body.total_duration_secs,
    updatedAt,
    receivedAt: now,
    deviceId: body.device_id ?? null,
  };

  const updateData = {
    ...baseData,
    ...(body.finished === undefined ? {} : { finished: body.finished }),
  };

  await prisma.bookListeningProgress.upsert({
    where: {
      userId_editionId: { userId, editionId },
    },
    update: updateData,
    create: {
      ...baseData,
      finished: body.finished ?? false,
      userId,
      editionId,
    },
  });

  await applyListeningCredit({
    userId,
    created: !existing,
    previous: existing,
    newPosition: body.position_secs,
    receivedAt: now,
  });

  if (body.device_id !== AUTO_SYNC_DEVICE_ID)
    void scheduleProgressSync({
      userId,
      bookId: edition.bookId,
      direction: "listen_to_read",
    });

  return "applied";
}

type ReadingBody = {
  file_id?: number | null;
  spine_index: number;
  spine_path: string;
  spine_count: number;
  scroll_fraction: number;
  locator?: string | null;
  finished?: boolean;
  updated_at: string;
  device_id?: string;
};

export type SaveReadingResult =
  | "edition_not_found"
  | "spine_out_of_range"
  | "stale"
  | "applied";

export async function saveReadingProgress(
  userId: string,
  editionId: number,
  body: ReadingBody,
): Promise<SaveReadingResult> {
  const edition = await findEditionForProgress(editionId);
  if (!edition) return "edition_not_found";

  if (body.spine_index < 0 || body.spine_index >= body.spine_count) {
    return "spine_out_of_range";
  }

  const now = new Date();
  const updatedAt = clampClientTimestamp(body.updated_at, now);

  const existing = await prisma.bookReadingProgress.findUnique({
    where: {
      userId_editionId: { userId, editionId },
    },
    select: { updatedAt: true },
  });
  if (existing && existing.updatedAt > updatedAt) return "stale";

  const baseData = {
    fileId: body.file_id ?? null,
    spineIndex: body.spine_index,
    spinePath: body.spine_path,
    spineCount: body.spine_count,
    // Clamped rather than rejected: a client that reports 1.0000001 after a
    // bounce-scroll should not lose its position over it.
    scrollFraction: Math.min(Math.max(body.scroll_fraction, 0), 1),
    locator: body.locator ?? null,
    updatedAt,
    receivedAt: now,
    deviceId: body.device_id ?? null,
  };

  await prisma.bookReadingProgress.upsert({
    where: {
      userId_editionId: { userId, editionId },
    },
    update: {
      ...baseData,
      ...(body.finished === undefined ? {} : { finished: body.finished }),
    },
    create: {
      ...baseData,
      finished: body.finished ?? false,
      userId,
      editionId,
    },
  });

  if (body.device_id !== AUTO_SYNC_DEVICE_ID)
    void scheduleProgressSync({
      userId,
      bookId: edition.bookId,
      direction: "read_to_listen",
    });

  return "applied";
}
