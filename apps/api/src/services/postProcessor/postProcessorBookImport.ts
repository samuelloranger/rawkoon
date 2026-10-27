import type { Stats } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { registerBookChapters } from "@rawkoon/api/services/books/registerBookChapters";
import { renameAudiobookChaptersFromEbook } from "@rawkoon/api/services/books/renameChaptersFromEbook";
import { emitBookUpdate } from "@rawkoon/api/services/libraryEvents";
import { notifyBookRequestAvailable } from "@rawkoon/api/services/mediaRequests";
import { placeFile } from "@rawkoon/api/services/postProcessor/postProcessorHelpers";
import {
  type BookKeeper,
  collectFiles,
  collectNarrators,
  DISCARD_EXT,
  loadEditionContext,
  probeBookFile,
  removeSupersededFiles,
  SAMPLE_RE,
} from "@rawkoon/api/services/postProcessor/postProcessorBookFiles";
import {
  isAudiobookFormat,
  parseBookReleaseTitle,
} from "@rawkoon/api/utils/books/bookReleaseParser";
import { formatForPath } from "@rawkoon/api/utils/books/ebookMetadata";
import { sha256File } from "@rawkoon/api/utils/books/fileHash";
import { renderBookTemplate } from "@rawkoon/api/utils/medias/fileTemplate";
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

export interface BookImportResult {
  imported: number;
  destinationPath: string | null;
  skipped: string[];
  error?: string;
  /** Set when the download itself holds nothing importable (blocklist it). */
  rejectKind?: "no_content";
}

type EditionContext = Exclude<
  Awaited<ReturnType<typeof loadEditionContext>>,
  { error: string }
>;

const failure = (
  skipped: string[],
  error: string,
  rejectKind?: "no_content",
): BookImportResult => ({
  imported: 0,
  destinationPath: null,
  skipped,
  error,
  ...(rejectKind ? { rejectKind } : {}),
});

/** Split candidates into importable keepers, recording why the rest were dropped. */
function selectKeepers(
  candidates: string[],
  kind: BookEditionKind,
  allowedFormats: string[],
  skipped: string[],
): BookKeeper[] {
  const keepers: BookKeeper[] = [];
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
  return keepers;
}

/**
 * Best format decides the directory name for ebooks (one file per format);
 * for audiobooks every keeper lands in the same directory anyway.
 */
function pickBestFormat(
  keepers: BookKeeper[],
  allowedFormats: string[],
): BookFormat {
  if (allowedFormats.length === 0) return keepers[0].format;
  return (
    keepers
      .slice()
      .sort(
        (a, b) =>
          allowedFormats.indexOf(a.format) - allowedFormats.indexOf(b.format),
      )[0]?.format ?? keepers[0].format
  );
}

/** Destination directory and (for ebooks) file stem from the naming template. */
function resolveDestination(
  ctx: EditionContext,
  bestFormat: BookFormat,
): { destDir: string; stem: string } {
  const { edition, kind, libraryRoot, template } = ctx;
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
  return {
    destDir: join(libraryRoot, destDirRel),
    stem: relParts[relParts.length - 1] ?? edition.book.title,
  };
}

/** (Re)write the BookFile row for a keeper already placed at `dst`. */
async function recordKeeper(
  keeper: BookKeeper,
  dst: string,
  editionId: number,
  parsedRelease: ReturnType<typeof parseBookReleaseTitle>,
  bookLanguage: string | null,
): Promise<void> {
  let st: Stats | null = null;
  try {
    st = await stat(dst);
  } catch {
    st = null;
  }

  const probe = await probeBookFile(dst, keeper.format);
  let languageTags = probe.languageTags;
  if (languageTags.length === 0) {
    const fallback = parsedRelease.language ?? bookLanguage;
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
      editionId,
      filePath: dst,
      fileName: basename(dst),
      sizeBytes: BigInt(st?.size ?? 0),
      sha256: await sha256File(dst),
      format: keeper.format,
      durationSecs: probe.durationSecs,
      audioBitrate: probe.audioBitrate ?? parsedRelease.audioBitrate,
      audioCodec: probe.audioCodec,
      isRetail: parsedRelease.isRetail,
      releaseGroup: parsedRelease.releaseGroup,
      languageTags,
      ...fileIno,
      fileMtimeMs: st ? BigInt(Math.trunc(st.mtimeMs)) : null,
    },
  });
}

/** Mark the edition downloaded and tell clients; runs once files are in place. */
async function finalizeEdition(
  editionId: number,
  bookId: number,
  kind: BookEditionKind,
): Promise<void> {
  // Narrators come from container tags, never from the metadata provider.
  const narrators = await collectNarrators(editionId);

  await prisma.bookEdition.update({
    where: { id: editionId },
    data: {
      status: "downloaded",
      ...(narrators.length > 0 ? { narrators } : {}),
    },
  });

  // Without a registered timeline the edition is not offline-ready, so every
  // manifest request 400s until someone rescans it by hand.
  if (kind === "audiobook") await registerBookChapters(editionId);
  // Whichever edition lands second lets the epub name the audiobook's placeholder chapters.
  await renameAudiobookChaptersFromEbook(bookId);

  // Push to any open client so the list and detail both update without polling,
  // the same way a movie import does.
  emitBookUpdate(bookId);
  await notifyBookRequestAvailable(bookId);
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
  const ctx = await loadEditionContext(opts.editionId);
  if (ctx.error !== undefined) return failure([], ctx.error);
  const { edition, kind } = ctx;

  const allowedFormats = edition.bookQualityProfile?.allowedFormats ?? [];
  const candidates = await collectFiles(opts.contentPath);
  if (candidates.length === 0) {
    return failure([], "No files found in completed download", "no_content");
  }

  const parsedRelease = parseBookReleaseTitle(opts.releaseTitle);
  const skipped: string[] = [];
  const keepers = selectKeepers(candidates, kind, allowedFormats, skipped);
  if (keepers.length === 0) {
    return failure(
      skipped,
      "No importable files in completed download",
      "no_content",
    );
  }

  const { destDir, stem } = resolveDestination(
    ctx,
    pickBestFormat(keepers, allowedFormats),
  );
  await mkdir(destDir, { recursive: true });

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
    await recordKeeper(
      keeper,
      dst,
      opts.editionId,
      parsedRelease,
      edition.book.language,
    );
    importedPaths.push(dst);
  }

  if (importedPaths.length === 0) {
    return failure(skipped, "Every candidate file failed to import");
  }

  if (opts.isUpgrade) {
    await removeSupersededFiles(opts.editionId, importedPaths);
  }
  await finalizeEdition(opts.editionId, edition.bookId, kind);

  return { imported: importedPaths.length, destinationPath: destDir, skipped };
}
