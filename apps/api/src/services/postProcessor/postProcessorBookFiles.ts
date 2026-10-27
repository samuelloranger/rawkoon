import { readdir, stat, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { isAudiobookFormat } from "@rawkoon/api/utils/books/bookReleaseParser";
import {
  formatForPath,
  readEbookMetadata,
} from "@rawkoon/api/utils/books/ebookMetadata";
import { scanMediaInfo } from "@rawkoon/api/utils/medias/mediainfoScanner";
import type { BookEditionKind, BookFormat } from "@rawkoon/shared/types";

/** Junk that ships alongside real book files and must never be imported. */
export const DISCARD_EXT = new Set([
  ".nfo",
  ".txt",
  ".cue",
  ".sfv",
  ".md5",
  ".url",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
]);

export const SAMPLE_RE = /\bsample\b/i;

const MAX_WALK_ENTRIES = 5000;

export type BookKeeper = { path: string; format: BookFormat };

/** Recursively collect candidate book files under a path. */
export async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [root];

  let visited = 0;
  while (queue.length > 0 && visited < MAX_WALK_ENTRIES) {
    const current = queue.shift();
    if (!current) break;
    visited++;

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(current);
    } catch {
      continue;
    }

    if (st.isFile()) {
      found.push(current);
      continue;
    }
    if (!st.isDirectory()) continue;

    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      continue;
    }
    for (const e of entries) queue.push(join(current, e));
  }

  return found;
}

/**
 * Load an edition with the settings and library root its kind imports into.
 * `error` is set when either is missing, mirroring what both import and
 * rescan report to their callers.
 */
export async function loadEditionContext(editionId: number) {
  const edition = await prisma.bookEdition.findUnique({
    where: { id: editionId },
    include: {
      book: {
        select: {
          title: true,
          authors: true,
          language: true,
          publishedYear: true,
        },
      },
      bookQualityProfile: { select: { allowedFormats: true } },
    },
  });
  if (!edition) return { error: "Edition not found" as const };

  const kind = edition.kind as BookEditionKind;
  const settings = await prisma.mediaSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  const libraryRoot =
    kind === "audiobook"
      ? settings.audiobooksLibraryPath
      : settings.booksLibraryPath;
  if (!libraryRoot) {
    return { error: `No ${kind} library path configured` };
  }

  const template =
    kind === "audiobook" ? settings.audiobookTemplate : settings.bookTemplate;
  return { edition, kind, settings, libraryRoot, template };
}

/** Container metadata for one book file: audio probe or ebook language. */
export async function probeBookFile(path: string, format: BookFormat) {
  let durationSecs: number | null = null;
  let audioBitrate: number | null = null;
  let audioCodec: string | null = null;
  let languageTags: string[] = [];

  if (isAudiobookFormat(format)) {
    // Audiobooks reuse mediainfoScanner: MediaInfo handles audio containers
    // properly, and this is the only source of duration and narrator tags,
    // since Google Books exposes neither.
    const info = await scanMediaInfo(path);
    if (info) {
      durationSecs = info.durationSecs;
      const track = info.audioTracks[0];
      if (track) {
        audioBitrate = track.bitrate_kbps;
        audioCodec = track.codec;
      }
      languageTags = info.audioTracks
        .map((t) => t.language)
        .filter((l): l is string => !!l);
    }
  } else {
    const meta = await readEbookMetadata(path);
    if (meta.language) languageTags = [meta.language];
  }

  return { durationSecs, audioBitrate, audioCodec, languageTags };
}

/** A file is a candidate unless it is junk, a sample, or not a book format. */
export function candidateFormat(
  filePath: string,
  kind: BookEditionKind,
): BookFormat | null {
  if (DISCARD_EXT.has(extname(filePath).toLowerCase())) return null;
  if (SAMPLE_RE.test(basename(filePath))) return null;
  const format = formatForPath(filePath);
  if (!format) return null;
  if (isAudiobookFormat(format) !== (kind === "audiobook")) return null;
  return format;
}

/**
 * Delete what an upgrade replaced.
 *
 * An upgrade that leaves the old copy in place is not an upgrade: the edition
 * would hold both formats, its aggregated size and duration would count both,
 * and the library would keep growing on every improvement. Mirrors the
 * upgrade cleanup in postProcessorSingle, with one difference — a book edition
 * legitimately holds many files, so the paths just imported are the keep list
 * rather than a single id.
 *
 * A file that cannot be deleted keeps its row: a row with no file is worse
 * than a file with no row, because rescan can find the second and nothing can
 * explain the first.
 */
export async function removeSupersededFiles(
  editionId: number,
  keepPaths: string[],
): Promise<void> {
  const old = await prisma.bookFile.findMany({
    where: { editionId, filePath: { notIn: keepPaths } },
    select: { id: true, filePath: true },
  });

  const removable: number[] = [];
  for (const file of old) {
    try {
      await unlink(file.filePath);
      removable.push(file.id);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        removable.push(file.id);
      } else {
        console.warn(
          `[postProcessBook/upgrade] could not delete superseded file ${file.filePath}:`,
          e,
        );
      }
    }
  }

  if (removable.length > 0) {
    await prisma.bookFile.deleteMany({ where: { id: { in: removable } } });
    console.log(
      `[postProcessBook/upgrade] removed ${removable.length} superseded file(s) from edition ${editionId}`,
    );
  }
}

/**
 * Audiobook narrators as recorded in the files' audio track titles. Best
 * effort: many releases carry nothing, and that is fine — the field stays empty
 * rather than being invented.
 */
export async function collectNarrators(editionId: number): Promise<string[]> {
  const files = await prisma.bookFile.findMany({
    where: { editionId },
    select: { filePath: true, format: true },
    take: 1,
  });
  const first = files[0];
  if (!first) return [];
  const format = first.format as BookFormat;
  if (!isAudiobookFormat(format)) return [];

  const info = await scanMediaInfo(first.filePath);
  if (!info) return [];
  const titles = info.audioTracks
    .map((t) => t.title)
    .filter((t): t is string => !!t && t.length < 120);
  return [...new Set(titles)];
}

export interface BookFileUpsert {
  editionId: number;
  filePath: string;
  fileName: string;
  sizeBytes: bigint;
  format: BookFormat;
  durationSecs: number | null;
  audioBitrate: number | null;
  audioCodec: string | null;
  languageTags: string[];
  fileDev: string;
  fileIno: string;
  fileMtimeMs: bigint;
  sha256: string | null;
}

/**
 * Keep BookFile ids stable on repeated scans keyed by path.
 * Chapters and clients reference the id, so rescan must update in place.
 */
export async function upsertBookFile(
  data: BookFileUpsert,
): Promise<{ id: number; existed: boolean }> {
  // Scoped to the edition, not the path alone. The update below writes
  // `editionId`, so a path-only lookup let two editions that point at the same
  // file steal the row from each other: rescanning a duplicate edition moved
  // the row off the real one, and rescanning the real one moved
  // it back. Whichever ran last owned the file and the other looked empty.
  const existing = await prisma.bookFile.findFirst({
    where: { editionId: data.editionId, filePath: data.filePath },
    select: { id: true },
  });

  if (existing) {
    await prisma.bookFile.update({
      where: { id: existing.id },
      data: {
        ...data,
        scannedAt: new Date(),
        // A scan has no release title to judge, so retail stays unknown.
        isRetail: false,
      },
    });
    return { id: existing.id, existed: true };
  }

  const created = await prisma.bookFile.create({
    data: {
      ...data,
      // A scan has no release title to judge, so retail stays unknown.
      isRetail: false,
    },
    select: { id: true },
  });
  return { id: created.id, existed: false };
}
