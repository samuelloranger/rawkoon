import type { Job } from "bullmq";
import { stat } from "node:fs/promises";
import { prisma } from "@rawkoon/api/db";
import {
  fileUnchanged,
  fingerprintDbFields,
  fingerprintFromStats,
  mapPool,
} from "@rawkoon/api/utils/medias/fileFingerprint";
import {
  remapPath,
  scanMediaInfo,
} from "@rawkoon/api/utils/medias/mediainfoScanner";
import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";

export type LibraryReindexLanguagesProgress = {
  current: number;
  total: number;
  current_file: string | null;
  updated: number;
  skipped: number;
  errors: number;
};

export type LibraryReindexLanguagesResult = {
  updated: number;
  skipped: number;
  errors: number;
};

const SCAN_CONCURRENCY = 4;
const DB_WRITE_CONCURRENCY = 8;
const PROGRESS_EVERY = 25;
/** Cursor page size for the full-table media_file sweep. */
const DB_PAGE_SIZE = 500;

/**
 * Re-runs mediainfo on every MediaFile and recomputes `languageTags`.
 * Skips files whose size+mtime fingerprint is unchanged (idempotent re-runs).
 */
export async function processLibraryReindexLanguagesJob(
  job: Job,
): Promise<LibraryReindexLanguagesResult> {
  const total = await prisma.mediaFile.count();

  const progress: LibraryReindexLanguagesProgress = {
    current: 0,
    total,
    current_file: null,
    updated: 0,
    skipped: 0,
    errors: 0,
  };
  await job.updateProgress(progress as unknown as object);

  type PendingWrite = {
    id: number;
    data: Record<string, unknown>;
  };
  const pendingWrites: PendingWrite[] = [];

  const flushWrites = async () => {
    if (pendingWrites.length === 0) return;
    const batch = pendingWrites.splice(0, pendingWrites.length);
    await mapPool(batch, DB_WRITE_CONCURRENCY, (w) =>
      prisma.mediaFile.update({ where: { id: w.id }, data: w.data }),
    );
  };

  let sinceProgress = 0;
  const bumpProgress = async (filePath: string | null) => {
    progress.current += 1;
    progress.current_file = filePath;
    sinceProgress += 1;
    if (sinceProgress >= PROGRESS_EVERY || progress.current >= progress.total) {
      sinceProgress = 0;
      await job.updateProgress(progress as unknown as object);
    }
  };

  const scanFile = async (file: {
    id: number;
    filePath: string;
    sizeBytes: bigint;
    fileMtimeMs: bigint | null;
  }) => {
    try {
      let st;
      try {
        st = await stat(remapPath(file.filePath), { bigint: true });
      } catch {
        progress.skipped += 1;
        await bumpProgress(file.filePath);
        return;
      }
      if (!st.isFile()) {
        progress.skipped += 1;
        await bumpProgress(file.filePath);
        return;
      }

      const fp = fingerprintFromStats(st);
      if (
        fileUnchanged(
          { sizeBytes: file.sizeBytes, fileMtimeMs: file.fileMtimeMs },
          fp,
        )
      ) {
        progress.skipped += 1;
        await bumpProgress(file.filePath);
        return;
      }

      const mi = await scanMediaInfo(file.filePath);
      if (!mi) {
        progress.skipped += 1;
      } else {
        const tags = classifyLanguageTags(
          mi.audioTracks as LibraryAudioTrack[],
          null,
        );
        pendingWrites.push({
          id: file.id,
          data: {
            ...fingerprintDbFields(fp),
            audioTracks: mi.audioTracks as object[],
            subtitleTracks: mi.subtitleTracks as object[],
            languageTags: tags,
            scannedAt: new Date(),
          },
        });
        progress.updated += 1;
      }
    } catch (e) {
      console.warn(
        `[reindexLanguages] Failed to rescan "${file.filePath}":`,
        e,
      );
      progress.errors += 1;
    }
    await bumpProgress(file.filePath);
  };

  // Cursor batches instead of one findMany over every media_file: a large
  // library would otherwise buffer the whole table (and every pending write)
  // for the lifetime of the job.
  let cursor: { id: number } | undefined;
  for (;;) {
    const batch = await prisma.mediaFile.findMany({
      take: DB_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
      select: {
        id: true,
        filePath: true,
        sizeBytes: true,
        fileMtimeMs: true,
      },
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    await mapPool(batch, SCAN_CONCURRENCY, scanFile);
    await flushWrites();

    if (batch.length < DB_PAGE_SIZE) break;
    cursor = { id: batch[batch.length - 1]!.id };
  }

  progress.current_file = null;
  await job.updateProgress(progress as unknown as object);

  return {
    updated: progress.updated,
    skipped: progress.skipped,
    errors: progress.errors,
  };
}
