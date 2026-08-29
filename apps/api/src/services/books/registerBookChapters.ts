import { basename } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { buildTimeline } from "@rawkoon/api/services/books/bookTimeline";
import { probeAudioDuration } from "@rawkoon/api/services/books/probeAudioDuration";

const ORDINAL = /^(\d+)\s*-\s*/;

/** "01 - Chapter 1.mp3" -> "Chapter 1". */
export const chapterTitleFromFileName = (name: string): string => {
  const stem = name.replace(/\.[^.]+$/, "");
  return stem.replace(ORDINAL, "").trim() || stem;
};

/** Numeric order by leading ordinal, so 10 follows 2 rather than preceding it. */
export const sortChapterFiles = (names: string[]): string[] =>
  [...names].sort((a, b) => {
    const na = Number(ORDINAL.exec(a)?.[1] ?? Number.NaN);
    const nb = Number(ORDINAL.exec(b)?.[1] ?? Number.NaN);
    if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
    return na - nb;
  });

export interface RegisterResult {
  chapters: number;
  totalDurationSecs: number;
  offlineReady: boolean;
  reason?: string;
}

/**
 * Probe, hash and register the audio files of an edition that is already one
 * file per chapter.
 *
 * Idempotent by database state: re-running over an unchanged edition rewrites
 * the same rows against the same BookFile ids, because upsertBookFile keeps
 * them stable. An edition with fewer than two audio files is not chapterized
 * and is refused rather than guessed at.
 */
export async function registerBookChapters(
  editionId: number,
): Promise<RegisterResult> {
  const files = await prisma.bookFile.findMany({
    where: { editionId },
    select: { id: true, filePath: true, fileName: true },
  });

  if (files.length < 2) {
    await prisma.bookEdition.update({
      where: { id: editionId },
      data: { offlineReady: false },
    });
    return {
      chapters: 0,
      totalDurationSecs: 0,
      offlineReady: false,
      reason: "Edition is not split into chapters",
    };
  }

  const byName = new Map(files.map((f) => [f.fileName, f]));
  const ordered = sortChapterFiles(files.map((f) => f.fileName));

  const inputs: { title: string; durationSecs: number }[] = [];
  const fileIds: number[] = [];
  for (const name of ordered) {
    const file = byName.get(name);
    if (!file) continue;

    const durationSecs = await probeAudioDuration(file.filePath);
    if (durationSecs === null) {
      await prisma.bookEdition.update({
        where: { id: editionId },
        data: { offlineReady: false },
      });
      return {
        chapters: 0,
        totalDurationSecs: 0,
        offlineReady: false,
        reason: `Could not probe ${basename(file.filePath)}`,
      };
    }

    inputs.push({ title: chapterTitleFromFileName(name), durationSecs });
    fileIds.push(file.id);
  }

  const timeline = buildTimeline(inputs);

  await prisma.$transaction(async (tx) => {
    await tx.bookChapter.deleteMany({ where: { editionId } });
    for (const chapter of timeline) {
      const bookFileId = fileIds[chapter.index];
      if (bookFileId === undefined) continue;

      await tx.bookChapter.create({
        data: {
          editionId,
          bookFileId,
          index: chapter.index,
          title: chapter.title,
          startSecs: chapter.startSecs,
          endSecs: chapter.endSecs,
        },
      });
      await tx.bookFile.update({
        where: { id: bookFileId },
        data: { chapterIndex: chapter.index },
      });
    }

    await tx.bookEdition.update({
      where: { id: editionId },
      data: { offlineReady: true },
    });
  });

  const totalDurationSecs = timeline.at(-1)?.endSecs ?? 0;
  return { chapters: timeline.length, totalDurationSecs, offlineReady: true };
}
