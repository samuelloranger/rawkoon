import type { Job } from "bullmq";
import { prisma } from "@rawkoon/api/db";
import { scanMediaInfo } from "@rawkoon/api/utils/medias/mediainfoScanner";
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

/**
 * Re-runs mediainfo on every MediaFile and recomputes `languageTags`.
 * Idempotent: safe to re-run.
 */
export async function processLibraryReindexLanguagesJob(
  job: Job,
): Promise<LibraryReindexLanguagesResult> {
  const files = await prisma.mediaFile.findMany({
    select: { id: true, filePath: true, mediaId: true, episodeId: true },
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

  for (const file of files) {
    progress.current += 1;
    progress.current_file = file.filePath;
    try {
      const mi = await scanMediaInfo(file.filePath);
      if (!mi) {
        progress.skipped += 1;
      } else {
        const tags = classifyLanguageTags(
          mi.audioTracks as LibraryAudioTrack[],
          null,
        );
        await prisma.mediaFile.update({
          where: { id: file.id },
          data: {
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
    await job.updateProgress(progress as unknown as object);
  }

  progress.current_file = null;
  await job.updateProgress(progress as unknown as object);

  return {
    updated: progress.updated,
    skipped: progress.skipped,
    errors: progress.errors,
  };
}
