import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { emitBookUpdate } from "@rawkoon/api/services/libraryEvents";
import {
  placeFile,
  resolveTorrentContentPath,
} from "@rawkoon/api/services/postProcessorHelpers";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { renderBookTemplate } from "@rawkoon/api/utils/medias/fileTemplate";
import {
  remapPath,
  scanMediaInfo,
} from "@rawkoon/api/utils/medias/mediainfoScanner";
import {
  formatForPath,
  readEbookMetadata,
} from "@rawkoon/api/utils/books/ebookMetadata";
import {
  isAudiobookFormat,
  parseBookReleaseTitle,
} from "@rawkoon/api/utils/books/bookReleaseParser";
import type { BookEditionKind, BookFormat } from "@rawkoon/shared/types";

/**
 * Book and audiobook import.
 *
 * A third sibling to postProcessorSingle and postProcessorSeasonPack, which
 * both assume ONE video file per grab. Books break that assumption as the norm
 * rather than the exception:
 *
 *  - An ebook grab commonly ships epub + mobi + azw3 + pdf of the same book.
 *    Every format the profile allows is imported as a sibling BookFile row
 *    under the one edition; the rest are dropped.
 *  - An audiobook grab is often dozens of mp3s plus a cue sheet and cover art.
 *    Each audio file becomes a BookFile row, and edition-level duration and
 *    size are aggregated by DB trigger.
 */

/** Junk that ships alongside real book files and must never be imported. */
const DISCARD_EXT = new Set([
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

const SAMPLE_RE = /\bsample\b/i;

const MAX_WALK_ENTRIES = 5000;

/** Recursively collect candidate book files under a path. */
async function collectFiles(root: string): Promise<string[]> {
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
async function removeSupersededFiles(
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

export interface BookImportResult {
  imported: number;
  destinationPath: string | null;
  skipped: string[];
  error?: string;
}

/**
 * Import a completed book download into the library.
 *
 * `allowedFormats` comes from the edition's profile and is authoritative: a
 * grab that happens to include a pdf when the profile only allows epub imports
 * the epub and drops the pdf.
 */
export async function postProcessBook(opts: {
  editionId: number;
  /** Resolved absolute path of the completed torrent's content. */
  contentPath: string;
  releaseTitle: string;
  fileOperation: "hardlink" | "move";
  /** Replaces what the edition already holds instead of adding to it. */
  isUpgrade?: boolean;
}): Promise<BookImportResult> {
  const edition = await prisma.bookEdition.findUnique({
    where: { id: opts.editionId },
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
  if (!edition)
    return {
      imported: 0,
      destinationPath: null,
      skipped: [],
      error: "Edition not found",
    };

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
    return {
      imported: 0,
      destinationPath: null,
      skipped: [],
      error: `No ${kind} library path configured`,
    };
  }

  const allowedFormats = edition.bookQualityProfile?.allowedFormats ?? [];
  const candidates = await collectFiles(opts.contentPath);
  if (candidates.length === 0) {
    return {
      imported: 0,
      destinationPath: null,
      skipped: [],
      error: "No files found in completed download",
    };
  }

  const parsedRelease = parseBookReleaseTitle(opts.releaseTitle);
  const skipped: string[] = [];

  type Keeper = { path: string; format: BookFormat };
  const keepers: Keeper[] = [];

  for (const filePath of candidates) {
    const ext = extname(filePath).toLowerCase();
    if (DISCARD_EXT.has(ext)) continue;
    if (SAMPLE_RE.test(basename(filePath))) {
      skipped.push(`${basename(filePath)} (sample)`);
      continue;
    }
    const format = formatForPath(filePath);
    if (!format) {
      skipped.push(`${basename(filePath)} (unrecognized format)`);
      continue;
    }
    // Keep only files matching the edition's kind: an ebook grab that also
    // bundles an mp3 teaser must not create audio rows on an ebook edition.
    const fileIsAudio = isAudiobookFormat(format);
    if (fileIsAudio !== (kind === "audiobook")) {
      skipped.push(`${basename(filePath)} (wrong kind for ${kind} edition)`);
      continue;
    }
    if (allowedFormats.length > 0 && !allowedFormats.includes(format)) {
      skipped.push(`${basename(filePath)} (${format} not allowed by profile)`);
      continue;
    }
    keepers.push({ path: filePath, format });
  }

  if (keepers.length === 0) {
    return {
      imported: 0,
      destinationPath: null,
      skipped,
      error: "No importable files in completed download",
    };
  }

  // Best format decides the directory name for ebooks (one file per format);
  // for audiobooks every keeper lands in the same directory anyway.
  const bestFormat =
    allowedFormats.length > 0
      ? (keepers
          .slice()
          .sort(
            (a, b) =>
              allowedFormats.indexOf(a.format) -
              allowedFormats.indexOf(b.format),
          )[0]?.format ?? keepers[0].format)
      : keepers[0].format;

  const template =
    kind === "audiobook" ? settings.audiobookTemplate : settings.bookTemplate;

  const rendered = renderBookTemplate(template, {
    author: edition.book.authors[0] ?? null,
    title: edition.book.title,
    year: edition.book.publishedYear,
    format: bestFormat,
    language: edition.book.language,
  });

  // The template renders a path whose last segment is the file stem for
  // ebooks, and the containing directory for audiobooks (whose tracks keep
  // their own names).
  const relParts = rendered.split("/").filter(Boolean);
  const destDirRel =
    kind === "audiobook" ? relParts.join("/") : relParts.slice(0, -1).join("/");
  const stem = relParts[relParts.length - 1] ?? edition.book.title;
  const destDir = join(libraryRoot, destDirRel);

  await mkdir(destDir, { recursive: true });

  let imported = 0;
  const importedPaths: string[] = [];
  for (const keeper of keepers) {
    const targetName =
      kind === "audiobook"
        ? basename(keeper.path)
        : `${stem}${extname(keeper.path)}`;
    const dst = join(destDir, targetName);

    try {
      await placeFile(keeper.path, dst, opts.fileOperation);
    } catch (e) {
      skipped.push(
        `${basename(keeper.path)} (${e instanceof Error ? e.message : "place failed"})`,
      );
      continue;
    }

    let st: Awaited<ReturnType<typeof stat>> | null = null;
    try {
      st = await stat(dst);
    } catch {
      st = null;
    }

    let durationSecs: number | null = null;
    let audioBitrate: number | null = null;
    let audioCodec: string | null = null;
    let languageTags: string[] = [];

    if (isAudiobookFormat(keeper.format)) {
      // Audiobooks reuse mediainfoScanner: MediaInfo handles audio containers
      // properly, and this is the only source of duration and narrator tags,
      // since Google Books exposes neither.
      const info = await scanMediaInfo(dst);
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
      const meta = await readEbookMetadata(dst);
      if (meta.language) languageTags = [meta.language];
    }

    if (languageTags.length === 0) {
      const fallback = parsedRelease.language ?? edition.book.language;
      if (fallback) languageTags = [fallback];
    }

    const fileIno = st
      ? { fileDev: String(st.dev), fileIno: String(st.ino) }
      : { fileDev: null, fileIno: null };

    // Idempotent: re-importing the same destination replaces its row rather
    // than accumulating duplicates, since a retried post-process is normal.
    await prisma.bookFile.deleteMany({ where: { filePath: dst } });
    await prisma.bookFile.create({
      data: {
        editionId: opts.editionId,
        filePath: dst,
        fileName: basename(dst),
        sizeBytes: BigInt(st?.size ?? 0),
        format: keeper.format,
        durationSecs,
        audioBitrate: audioBitrate ?? parsedRelease.audioBitrate,
        audioCodec,
        isRetail: parsedRelease.isRetail,
        releaseGroup: parsedRelease.releaseGroup,
        languageTags,
        ...fileIno,
        fileMtimeMs: st ? BigInt(Math.trunc(st.mtimeMs)) : null,
      },
    });

    imported++;
    importedPaths.push(dst);
  }

  if (imported === 0) {
    return {
      imported: 0,
      destinationPath: null,
      skipped,
      error: "Every candidate file failed to import",
    };
  }

  if (opts.isUpgrade && importedPaths.length > 0) {
    await removeSupersededFiles(opts.editionId, importedPaths);
  }

  // Narrators come from container tags, never from the metadata provider.
  const narrators = await collectNarrators(opts.editionId);

  await prisma.bookEdition.update({
    where: { id: opts.editionId },
    data: {
      status: "downloaded",
      ...(narrators.length > 0 ? { narrators } : {}),
    },
  });

  // Push to any open client so the list and detail both update without polling,
  // the same way a movie import does.
  emitBookUpdate(edition.bookId);

  return { imported, destinationPath: destDir, skipped };
}

/**
 * Audiobook narrators as recorded in the files' audio track titles. Best
 * effort: many releases carry nothing, and that is fine — the field stays empty
 * rather than being invented.
 */
async function collectNarrators(editionId: number): Promise<string[]> {
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

/**
 * Entry point used by the post-process job. Resolves the completed torrent's
 * content path from the download client, then imports it.
 *
 * Returns the same shape as postProcessorSingle.postProcess so
 * downloadOutcome.finishPostProcess can dispatch on the download_history row's
 * foreign key without special-casing the result.
 */
export async function postProcessBookDownload(
  downloadHistoryId: number,
): Promise<
  | { success: true; destinationPath: string }
  | { success: false; reason: string }
> {
  const [dh, settings] = await Promise.all([
    prisma.downloadHistory.findUnique({
      where: { id: downloadHistoryId },
      select: {
        id: true,
        bookEditionId: true,
        torrentHash: true,
        releaseTitle: true,
        failed: true,
        completedAt: true,
        isUpgrade: true,
      },
    }),
    prisma.mediaSettings.findUnique({ where: { id: 1 } }),
  ]);

  if (!dh?.bookEditionId) {
    return {
      success: false,
      reason: "Download history or book edition not found",
    };
  }
  if (dh.failed || !dh.completedAt) {
    return { success: false, reason: "Download not completed" };
  }
  if (!settings?.postProcessingEnabled) {
    return { success: false, reason: "Post-processing disabled" };
  }

  // ── Pre-scan: are the files already in the library? ─────────────────────────
  // The counterpart of the pre-scan in postProcessorSingle, and the reason a
  // re-grab after a deleted-and-re-added book used to dead-end: the file was
  // already on disk, but nothing looked before asking the download client.
  //
  // Skipped for upgrades, where the file being replaced is still present and
  // would short-circuit the very import that is meant to replace it.
  if (!dh.isUpgrade) {
    const existing = await prisma.bookFile.findMany({
      where: { editionId: dh.bookEditionId },
      select: { filePath: true },
    });
    for (const file of existing) {
      try {
        await stat(file.filePath);
      } catch {
        continue;
      }
      await prisma.bookEdition.update({
        where: { id: dh.bookEditionId },
        data: { status: "downloaded" },
      });
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          postProcessDestinationPath: file.filePath,
          postProcessError: null,
        },
      });
      const ed = await prisma.bookEdition.findUnique({
        where: { id: dh.bookEditionId },
        select: { bookId: true },
      });
      if (ed) emitBookUpdate(ed.bookId);
      return { success: true, destinationPath: file.filePath };
    }

    // No rows, or every row's file is gone: the files may still be on disk from
    // an earlier import whose rows were removed with the book. Adopting them
    // costs a couple of stat calls on a fresh grab, where the directory does
    // not exist yet and the scan finds nothing.
    const rescan = await rescanBookEdition(dh.bookEditionId);
    if (rescan.registered > 0 && rescan.directory) {
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          postProcessDestinationPath: rescan.directory,
          postProcessError: null,
        },
      });
      return { success: true, destinationPath: rescan.directory };
    }
  }

  const hash = dh.torrentHash?.trim();
  if (!hash) return { success: false, reason: "Torrent hash unknown" };

  const active = await resolveActiveAdapter();
  if (!active) {
    return { success: false, reason: "Download client not configured" };
  }

  const tor = await active.adapter.getTorrent(hash);
  if (!tor) {
    return { success: false, reason: "Torrent not found in download client" };
  }

  const contentBase = resolveTorrentContentPath(
    tor.contentPath,
    tor.savePath,
    tor.name,
  );
  if (!contentBase) {
    return { success: false, reason: "Could not resolve torrent content path" };
  }

  const result = await postProcessBook({
    editionId: dh.bookEditionId,
    contentPath: remapPath(contentBase),
    releaseTitle: dh.releaseTitle,
    fileOperation: settings.fileOperation === "move" ? "move" : "hardlink",
    isUpgrade: dh.isUpgrade,
  });

  if (result.error || !result.destinationPath) {
    return {
      success: false,
      reason: result.error ?? "Import produced no files",
    };
  }
  if (result.skipped.length > 0) {
    console.warn(
      `[postProcessBook] dh#${downloadHistoryId} skipped ${result.skipped.length} file(s): ${result.skipped.join("; ")}`,
    );
  }
  return { success: true, destinationPath: result.destinationPath };
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
}

/**
 * Keep BookFile ids stable on repeated scans keyed by path.
 * Chapters and clients reference the id, so rescan must update in place.
 */
export async function upsertBookFile(
  data: BookFileUpsert,
): Promise<{ id: number; existed: boolean }> {
  const existing = await prisma.bookFile.findFirst({
    where: { filePath: data.filePath },
    select: { id: true },
  });

  if (existing) {
    await prisma.bookFile.update({
      where: { id: existing.id },
      data: {
        ...data,
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

/**
 * Register files already sitting in the library for an edition that has none.
 *
 * Two situations produce that state, and both were unreachable before this
 * existed:
 *
 *  - Removing a book keeps its files on disk by design. Re-adding the book
 *    creates a fresh edition with no file rows, so the library shows it as
 *    wanted while the file is right there.
 *  - A post-process that placed files but failed before writing its rows.
 *
 * Mirrors the pre-scan postProcessorSingle does for media. It only ever looks
 * inside the directory the naming template points at, so it cannot sweep in
 * unrelated files, and it drops rows whose file has since disappeared.
 */
export async function rescanBookEdition(editionId: number): Promise<{
  /** Files that had no row before this scan. */
  registered: number;
  /** Files that already had a row, whose metadata was re-read. */
  refreshed: number;
  removed: number;
  directory: string | null;
  error?: string;
}> {
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
  if (!edition) {
    return {
      registered: 0,
      refreshed: 0,
      removed: 0,
      directory: null,
      error: "Edition not found",
    };
  }

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
    return {
      registered: 0,
      refreshed: 0,
      removed: 0,
      directory: null,
      error: `No ${kind} library path configured`,
    };
  }

  // Drop rows whose file is gone, so a rescan also cleans up after a manual
  // deletion on disk.
  let removed = 0;
  const known = await prisma.bookFile.findMany({
    where: { editionId },
    select: { id: true, filePath: true },
  });
  for (const f of known) {
    try {
      await stat(f.filePath);
    } catch {
      await prisma.bookFile.delete({ where: { id: f.id } });
      removed++;
    }
  }

  const allowedFormats = edition.bookQualityProfile?.allowedFormats ?? [];
  const template =
    kind === "audiobook" ? settings.audiobookTemplate : settings.bookTemplate;

  // The template's own format token is unknown before scanning, so try each
  // allowed format's rendering plus a format-less one. Whichever directory
  // exists is the edition's.
  const candidateFormats: (string | null)[] = [
    ...(allowedFormats.length > 0 ? allowedFormats : []),
    null,
  ];
  const seenDirs = new Set<string>();
  let directory: string | null = null;
  let keepers: { path: string; format: BookFormat }[] = [];

  for (const fmt of candidateFormats) {
    const rendered = renderBookTemplate(template, {
      author: edition.book.authors[0] ?? null,
      title: edition.book.title,
      year: edition.book.publishedYear,
      format: fmt,
      language: edition.book.language,
    });
    const relParts = rendered.split("/").filter(Boolean);
    const relDir =
      kind === "audiobook"
        ? relParts.join("/")
        : relParts.slice(0, -1).join("/");
    const dir = join(libraryRoot, relDir);
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);

    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;

    const found: { path: string; format: BookFormat }[] = [];
    for (const filePath of await collectFiles(dir)) {
      if (DISCARD_EXT.has(extname(filePath).toLowerCase())) continue;
      if (SAMPLE_RE.test(basename(filePath))) continue;
      const format = formatForPath(filePath);
      if (!format) continue;
      if (isAudiobookFormat(format) !== (kind === "audiobook")) continue;
      found.push({ path: filePath, format });
    }
    if (found.length > 0) {
      directory = dir;
      keepers = found;
      break;
    }
  }

  if (keepers.length === 0) {
    // Nothing on disk. If rows were removed the edition no longer has files,
    // so put it back to wanted rather than leaving a lie on screen.
    if (removed > 0) {
      await prisma.bookEdition.update({
        where: { id: editionId },
        data: { status: "wanted" },
      });
      emitBookUpdate(edition.bookId);
    }
    return { registered: 0, refreshed: 0, removed, directory: null };
  }

  let registered = 0;
  let refreshed = 0;
  for (const keeper of keepers) {
    let st: Awaited<ReturnType<typeof stat>> | null = null;
    try {
      st = await stat(keeper.path);
    } catch {
      continue;
    }

    let durationSecs: number | null = null;
    let audioBitrate: number | null = null;
    let audioCodec: string | null = null;
    let languageTags: string[] = [];

    if (isAudiobookFormat(keeper.format)) {
      const info = await scanMediaInfo(keeper.path);
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
      const meta = await readEbookMetadata(keeper.path);
      if (meta.language) languageTags = [meta.language];
    }
    if (languageTags.length === 0) languageTags = [edition.book.language];

    const { existed } = await upsertBookFile({
      editionId,
      filePath: keeper.path,
      fileName: basename(keeper.path),
      sizeBytes: BigInt(st.size),
      format: keeper.format,
      durationSecs,
      audioBitrate,
      audioCodec,
      languageTags,
      fileDev: String(st.dev),
      fileIno: String(st.ino),
      fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
    });

    if (existed) refreshed++;
    else registered++;
  }

  if (registered + refreshed > 0) {
    await prisma.bookEdition.update({
      where: { id: editionId },
      data: { status: "downloaded" },
    });
    emitBookUpdate(edition.bookId);
  }

  return { registered, refreshed, removed, directory };
}
