import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { registerBookChapters } from "@rawkoon/api/services/books/registerBookChapters";
import { emitBookUpdate } from "@rawkoon/api/services/libraryEvents";
import { notifyBookRequestAvailable } from "@rawkoon/api/services/mediaRequests";
import {
  type BookKeeper,
  candidateFormat,
  collectFiles,
  loadEditionContext,
  probeBookFile,
  upsertBookFile,
} from "@rawkoon/api/services/postProcessor/postProcessorBookFiles";
import { sha256File } from "@rawkoon/api/utils/books/fileHash";
import { renderBookTemplate } from "@rawkoon/api/utils/medias/fileTemplate";
import type { BookEditionKind } from "@rawkoon/shared/types";

type EditionContext = Exclude<
  Awaited<ReturnType<typeof loadEditionContext>>,
  { error: string }
>;

type KnownFile = {
  id: number;
  filePath: string;
  sizeBytes: bigint;
  fileDev: string | null;
  fileIno: string | null;
  fileMtimeMs: bigint | null;
};

/**
 * Drop rows whose file is gone, so a rescan also cleans up after a manual
 * deletion on disk. Returns the surviving rows by path and the removed count.
 */
async function dropMissingRows(editionId: number) {
  let removed = 0;
  const known = await prisma.bookFile.findMany({
    where: { editionId },
    select: {
      id: true,
      filePath: true,
      sizeBytes: true,
      fileDev: true,
      fileIno: true,
      fileMtimeMs: true,
    },
  });
  const survivors = new Map<string, KnownFile>();
  for (const f of known) {
    try {
      await stat(f.filePath);
      survivors.set(f.filePath, f);
    } catch {
      await prisma.bookFile.delete({ where: { id: f.id } });
      removed++;
    }
  }
  return { survivors, removed };
}

async function invalidateChapterTimeline(editionId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // A changed file set invalidates the whole chapter timeline because each
    // chapter's start/end offsets are cumulative from all prior chapters.
    await tx.bookChapter.deleteMany({ where: { editionId } });
    await tx.bookEdition.update({
      where: { id: editionId },
      data: { offlineReady: false },
    });
  });
}

/** Directories that may hold the edition's files, rendered names first. */
function candidateDirs(ctx: EditionContext, rowPaths: string[]): string[] {
  const { edition, kind, libraryRoot, template } = ctx;
  const allowedFormats = edition.bookQualityProfile?.allowedFormats ?? [];

  // The template's own format token is unknown before scanning, so try each
  // allowed format's rendering plus a format-less one. Whichever directory
  // exists is the edition's.
  const candidateFormats: (string | null)[] = [
    ...(allowedFormats.length > 0 ? allowedFormats : []),
    null,
  ];
  const renderedDirs = candidateFormats.map((fmt) => {
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
    return join(libraryRoot, relDir);
  });

  // A metadata refresh can change {title} or {year} after the import that
  // created the directory: "La femme de ménage (2023)" on disk, publishedYear
  // now 2024. Re-rendering the template then names a directory that never
  // existed, and the rescan answered "no files found in the library for this
  // edition" about files sitting right there. The parent directories of the
  // rows already on the edition are the fallback — that is where the files
  // actually are. Rendered names come first, so a library that really was
  // renamed to match new metadata still wins.
  const rowDirs = [...new Set(rowPaths.map((p) => dirname(p)))];
  return [...renderedDirs, ...rowDirs];
}

/** First candidate directory that exists and holds at least one book file. */
async function findEditionFiles(
  dirs: string[],
  kind: BookEditionKind,
): Promise<{ directory: string | null; keepers: BookKeeper[] }> {
  const seenDirs = new Set<string>();
  for (const dir of dirs) {
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);

    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;

    const found: BookKeeper[] = [];
    for (const filePath of await collectFiles(dir)) {
      const format = candidateFormat(filePath, kind);
      if (format) found.push({ path: filePath, format });
    }
    if (found.length > 0) return { directory: dir, keepers: found };
  }
  return { directory: null, keepers: [] };
}

/**
 * True when the keeper's bytes are unchanged from its existing row. Probing
 * costs an ffprobe spawn each time; on a 60+ chapter audiobook that made every
 * rescan take tens of seconds — a cost the iOS client paid on every open of a
 * book whose manifest was not ready yet.
 */
function isUnchanged(
  prior: KnownFile | undefined,
  st: Stats,
): prior is KnownFile {
  return (
    !!prior &&
    prior.fileDev === String(st.dev) &&
    prior.fileIno === String(st.ino) &&
    prior.fileMtimeMs !== null &&
    prior.fileMtimeMs === BigInt(Math.trunc(st.mtimeMs)) &&
    prior.sizeBytes === BigInt(st.size)
  );
}

/** Register new or changed keepers and count what happened to each. */
async function syncKeepers(
  editionId: number,
  bookLanguage: string,
  keepers: BookKeeper[],
  survivors: Map<string, KnownFile>,
) {
  let registered = 0;
  let refreshed = 0;
  // Files whose bytes actually changed, as opposed to the ones the fast path
  // left alone. A chapter replaced or re-encoded in place keeps its row,
  // so it counts as neither registered nor removed — but its duration moved,
  // which shifts every cumulative offset after it in the timeline.
  let reprobed = 0;
  for (const keeper of keepers) {
    let st: Stats | null = null;
    try {
      st = await stat(keeper.path);
    } catch {
      continue;
    }

    const prior = survivors.get(keeper.path);
    if (isUnchanged(prior, st)) {
      await prisma.bookFile.update({
        where: { id: prior.id },
        data: { scannedAt: new Date() },
      });
      refreshed++;
      continue;
    }

    reprobed++;

    const probe = await probeBookFile(keeper.path, keeper.format);
    const languageTags =
      probe.languageTags.length === 0 ? [bookLanguage] : probe.languageTags;

    const { existed } = await upsertBookFile({
      editionId,
      filePath: keeper.path,
      fileName: basename(keeper.path),
      sizeBytes: BigInt(st.size),
      format: keeper.format,
      durationSecs: probe.durationSecs,
      audioBitrate: probe.audioBitrate,
      audioCodec: probe.audioCodec,
      languageTags,
      fileDev: String(st.dev),
      fileIno: String(st.ino),
      fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
      sha256: await sha256File(keeper.path),
    });

    if (existed) refreshed++;
    else registered++;
  }
  return { registered, refreshed, reprobed };
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
  const ctx = await loadEditionContext(editionId);
  if (ctx.error !== undefined) {
    return {
      registered: 0,
      refreshed: 0,
      removed: 0,
      directory: null,
      error: ctx.error,
    };
  }
  const { edition, kind } = ctx;

  const { survivors, removed } = await dropMissingRows(editionId);

  const { directory, keepers } = await findEditionFiles(
    candidateDirs(ctx, [...survivors.keys()]),
    kind,
  );

  if (keepers.length === 0) {
    // Nothing on disk. If rows were removed the edition no longer has files,
    // so put it back to wanted rather than leaving a lie on screen.
    if (removed > 0) {
      await invalidateChapterTimeline(editionId);
      await prisma.bookEdition.update({
        where: { id: editionId },
        data: { status: "wanted" },
      });
      emitBookUpdate(edition.bookId);
    }
    return { registered: 0, refreshed: 0, removed, directory: null };
  }

  const { registered, refreshed, reprobed } = await syncKeepers(
    editionId,
    edition.book.language,
    keepers,
    survivors,
  );

  let shouldEmitBookUpdate = false;

  if (registered + refreshed > 0) {
    await prisma.bookEdition.update({
      where: { id: editionId },
      data: { status: "downloaded" },
    });
    shouldEmitBookUpdate = true;
  }

  if (removed > 0 || registered > 0 || reprobed > 0) {
    await invalidateChapterTimeline(editionId);
    shouldEmitBookUpdate = true;
  }

  // Registering the chapter timeline is what flips `offlineReady`, and nothing
  // in the import path was doing it — so a chapterized audiobook stayed "not
  // offline-ready" forever, every manifest request 400'd, and every client that
  // asked triggered yet another rescan. Runs after the invalidation above so it
  // rebuilds rather than races it.
  if (
    kind === "audiobook" &&
    (registered > 0 || removed > 0 || reprobed > 0 || !edition.offlineReady)
  ) {
    const registration = await registerBookChapters(editionId);
    if (registration.offlineReady) shouldEmitBookUpdate = true;
  }

  if (shouldEmitBookUpdate) {
    emitBookUpdate(edition.bookId);
  }
  if (registered + refreshed > 0) {
    await notifyBookRequestAvailable(edition.bookId);
  }

  return { registered, refreshed, removed, directory };
}
