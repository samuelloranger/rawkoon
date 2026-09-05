import { basename } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { buildTimeline } from "@rawkoon/api/services/books/bookTimeline";
import { probeAudioDuration } from "@rawkoon/api/services/books/probeAudioDuration";
import {
  type ChapterAtom,
  probeChapterAtoms,
} from "@rawkoon/api/services/books/probeChapterAtoms";

// The separator after the leading number varies by release: "01 - Chapter 1",
// "01. Chapter 1", "62 Epilogue". Requiring a dash meant the whole "NN Title"
// family matched nothing, so chapter titles kept their number prefix and the
// sort fell through to localeCompare — which is right only while every name is
// zero-padded to the same width, and puts 10 before 2 as soon as one is not.
// A separator is still required, so a title that merely starts with digits
// ("1984.mp3") is not mistaken for an ordinal.
const ORDINAL = /^(\d+)(?:\s*[-–—._]\s*|\s+)/;
const ordinalOf = (name: string): number =>
  Number(ORDINAL.exec(name)?.[1] ?? Number.NaN);
const compareChapterFileNames = (a: string, b: string): number => {
  const na = ordinalOf(a);
  const nb = ordinalOf(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
  return na - nb;
};

/** "01 - Chapter 1.mp3" and "62 Epilogue.mp3" -> "Chapter 1" / "Epilogue". */
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

interface ChapterRow {
  bookFileId: number;
  index: number;
  title: string;
  startSecs: number;
  endSecs: number;
}

/** Write chapter rows for an edition and mark it offline-ready, atomically. */
const writeChapters = async (
  editionId: number,
  rows: ChapterRow[],
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.bookChapter.deleteMany({ where: { editionId } });
    for (const row of rows) {
      await tx.bookChapter.create({
        data: {
          editionId,
          bookFileId: row.bookFileId,
          index: row.index,
          title: row.title,
          startSecs: row.startSecs,
          endSecs: row.endSecs,
        },
      });
      await tx.bookFile.update({
        where: { id: row.bookFileId },
        data: { chapterIndex: row.index },
      });
    }
    await tx.bookEdition.update({
      where: { id: editionId },
      data: { offlineReady: true },
    });
  });
};

// Frame-boundary rounding on an `-c copy` remux drifts the atom offsets by a
// second or two against the probed stream duration; tolerate that much before
// judging the atoms nonsensical.
const ATOM_TOLERANCE_SECS = 2;

/**
 * Do the embedded atoms describe a sane, gap-free-enough cover of the file?
 *
 * Rejects overlaps, zero/negative-length chapters, and offsets that fall
 * outside the probed duration. A false here means fall back to a single
 * whole-file chapter rather than trust garbage offsets.
 */
const atomsAreConsistent = (
  atoms: ChapterAtom[],
  totalDurationSecs: number,
): boolean => {
  let cursor = 0;
  for (const atom of atoms) {
    if (!Number.isFinite(atom.startSecs) || !Number.isFinite(atom.endSecs)) {
      return false;
    }
    if (atom.startSecs < 0) return false;
    if (atom.endSecs <= atom.startSecs) return false;
    // Starts before the previous chapter ended -> overlap.
    if (atom.startSecs + ATOM_TOLERANCE_SECS < cursor) return false;
    if (atom.startSecs > totalDurationSecs + ATOM_TOLERANCE_SECS) return false;
    cursor = atom.endSecs;
  }
  if (cursor > totalDurationSecs + ATOM_TOLERANCE_SECS) return false;
  return true;
};

/**
 * Register the chapters of a single-file audiobook (one .m4b/.mp3 for the whole
 * book).
 *
 * Prefers the container's embedded chapter atoms; when there are none — or they
 * are inconsistent — falls back to one chapter spanning the file so the book is
 * at least playable. Either way the edition becomes offline-ready. Only an
 * unprobeable duration is refused, since without it there is no timeline at all.
 */
const registerSingleFileEdition = async (
  editionId: number,
  file: { id: number; filePath: string; fileName: string },
): Promise<RegisterResult> => {
  const totalDurationSecs = await probeAudioDuration(file.filePath);
  if (totalDurationSecs === null) {
    return refuseChapterRegistration(
      editionId,
      `Could not probe ${basename(file.filePath)}`,
    );
  }

  const atoms = await probeChapterAtoms(file.filePath);

  let rows: ChapterRow[];
  if (atoms && atomsAreConsistent(atoms, totalDurationSecs)) {
    const lastIndex = atoms.length - 1;
    rows = atoms.map((atom, index) => ({
      bookFileId: file.id,
      index,
      title: atom.title || `Chapter ${index + 1}`,
      startSecs: Math.min(atom.startSecs, totalDurationSecs),
      // The atoms are already whole-file offsets, so they are used directly
      // (never run through buildTimeline, which accumulates per-file durations).
      // The final chapter is pinned to the probed total so the timeline covers
      // the whole file exactly, absorbing any remux rounding.
      endSecs:
        index === lastIndex
          ? totalDurationSecs
          : Math.min(atom.endSecs, totalDurationSecs),
    }));
  } else {
    const edition = await prisma.bookEdition.findUnique({
      where: { id: editionId },
      select: { book: { select: { title: true } } },
    });
    const title =
      edition?.book.title ?? chapterTitleFromFileName(file.fileName);
    rows = [
      {
        bookFileId: file.id,
        index: 0,
        title,
        startSecs: 0,
        endSecs: totalDurationSecs,
      },
    ];
  }

  await writeChapters(editionId, rows);

  return {
    chapters: rows.length,
    totalDurationSecs,
    offlineReady: true,
  };
};

/**
 * Probe and register the audio files of an edition that is already one file
 * per chapter.
 *
 * Idempotent by database state: re-running over an unchanged edition rewrites
 * equivalent chapter rows against the same BookFile ids. Chapter row ids are
 * not stable across runs because the refresh is delete-then-create.
 * A single-file edition is chapterized from its embedded chapter atoms, or from
 * one whole-file chapter when it has none (see registerSingleFileEdition); only
 * an edition with no audio files at all is refused.
 */
export async function registerBookChapters(
  editionId: number,
): Promise<RegisterResult> {
  const files = await prisma.bookFile.findMany({
    where: { editionId },
    select: { id: true, filePath: true, fileName: true },
  });

  if (files.length === 0) {
    return refuseChapterRegistration(editionId, "Edition has no audio files");
  }

  if (files.length === 1) {
    return registerSingleFileEdition(editionId, files[0]!);
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
