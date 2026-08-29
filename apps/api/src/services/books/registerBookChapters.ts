import { basename } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { buildTimeline } from "@rawkoon/api/services/books/bookTimeline";
import { probeAudioDuration } from "@rawkoon/api/services/books/probeAudioDuration";

const ORDINAL = /^(\d+)\s*-\s*/;
const ordinalOf = (name: string): number =>
  Number(ORDINAL.exec(name)?.[1] ?? Number.NaN);
const compareChapterFileNames = (a: string, b: string): number => {
  const na = ordinalOf(a);
  const nb = ordinalOf(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
  return na - nb;
};

/** "01 - Chapter 1.mp3" -> "Chapter 1". */
export const chapterTitleFromFileName = (name: string): string => {
  const stem = name.replace(/\.[^.]+$/, "");
  return stem.replace(ORDINAL, "").trim() || stem;
};

/** Numeric order by leading ordinal, so 10 follows 2 rather than preceding it. */
export const sortChapterFiles = (names: string[]): string[] =>
  [...names].sort(compareChapterFileNames);

export interface RegisterResult {
  chapters: number;
  totalDurationSecs: number;
  offlineReady: boolean;
  reason?: string;
}

const sortBookFiles = (
  files: Array<{ id: number; filePath: string; fileName: string }>,
) =>
  // Sort file objects directly so duplicate basenames map to distinct rows.
  [...files].sort((a, b) => compareChapterFileNames(a.fileName, b.fileName));

const refuseChapterRegistration = async (
  editionId: number,
  reason: string,
): Promise<RegisterResult> => {
  await prisma.$transaction(async (tx) => {
    // Stale chapters are worse than no chapters: a cached manifest cannot
    // infer that old offsets no longer match files on disk.
    await tx.bookChapter.deleteMany({ where: { editionId } });
    await tx.bookEdition.update({
      where: { id: editionId },
      data: { offlineReady: false },
    });
  });

  return {
    chapters: 0,
    totalDurationSecs: 0,
    offlineReady: false,
    reason,
  };
};

/**
 * Probe and register the audio files of an edition that is already one file
 * per chapter.
 *
 * Idempotent by database state: re-running over an unchanged edition rewrites
 * equivalent chapter rows against the same BookFile ids. Chapter row ids are
 * not stable across runs because the refresh is delete-then-create.
 * An edition with fewer than two audio files is not chapterized and is refused
 * rather than guessed at.
 */
export async function registerBookChapters(
  editionId: number,
): Promise<RegisterResult> {
  const files = await prisma.bookFile.findMany({
    where: { editionId },
    select: { id: true, filePath: true, fileName: true },
  });

  if (files.length < 2) {
    return refuseChapterRegistration(
      editionId,
      "Edition is not split into chapters",
    );
  }

  const ordered = sortBookFiles(files);

  const chapterInputs: Array<{
    title: string;
    durationSecs: number;
    bookFileId: number;
  }> = [];
  for (const file of ordered) {
    const title = chapterTitleFromFileName(file.fileName);

    const durationSecs = await probeAudioDuration(file.filePath);
    if (durationSecs === null) {
      return refuseChapterRegistration(
        editionId,
        `Could not probe ${basename(file.filePath)}`,
      );
    }

    chapterInputs.push({ title, durationSecs, bookFileId: file.id });
  }

  const timeline = buildTimeline(
    chapterInputs.map(({ title, durationSecs }) => ({ title, durationSecs })),
  );

  await prisma.$transaction(async (tx) => {
    await tx.bookChapter.deleteMany({ where: { editionId } });
    for (const chapter of timeline) {
      const { bookFileId } = chapterInputs[chapter.index]!;

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
