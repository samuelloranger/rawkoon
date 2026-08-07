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

/**
 * Re-runs mediainfo on every MediaFile and recomputes `languageTags`.
 * Skips files whose size+mtime fingerprint is unchanged (idempotent re-runs).
 */
export async function processLibraryReindexLanguagesJob(
  job: Job,
): Promise<LibraryReindexLanguagesResult> {
  const files = await prisma.mediaFile.findMany({
    select: {
      id: true,
      filePath: true,
      mediaId: true,
      episodeId: true,
      sizeBytes: true,
      fileMtimeMs: true,
      fileDev: true,
      fileIno: true,
    },
    orderBy: { id: "asc" },
  });

  const progress: LibraryReindexLanguagesProgress = {
    current: 0,
    total: files.length,
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

  await mapPool(files, SCAN_CONCURRENCY, async (file) => {
    try {
      let st;
      try {
        st = await stat(remapPath(file.filePath));
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
  });

  await flushWrites();
  progress.current_file = null;
  await job.updateProgress(progress as unknown as object);

  return {
    updated: progress.updated,
    skipped: progress.skipped,
    errors: progress.errors,
  };
}
