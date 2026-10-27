import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { registerBookChapters } from "@rawkoon/api/services/books/registerBookChapters";
import { renameAudiobookChaptersFromEbook } from "@rawkoon/api/services/books/renameChaptersFromEbook";
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

/** Drop rows whose file is gone; returns surviving rows by path and the removed count. */
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
    // A changed file set invalidates the chapter timeline: offsets are cumulative.
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

  // The template's format token is unknown pre-scan, so try each allowed format plus a format-less one.
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

  // A metadata refresh can change {title}/{year} after import, so re-rendering names a nonexistent dir; fall back to the existing rows' parents, rendered names first.
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

/** True when the keeper's bytes match its existing row; skips an ffprobe spawn per chapter, which made rescans take tens of seconds. */
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
  // Files whose bytes changed in place: neither registered nor removed, but their duration shifts later offsets.
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

/** Register files already in the library for an edition with none (e.g. a re-added book whose files were kept, or a post-process that failed before writing rows); only scans the template's directory. */
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
    // Nothing on disk: if rows were removed, put the edition back to wanted.
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

  // Registering the chapter timeline flips `offlineReady`; runs after the invalidation above so it rebuilds rather than races.
  if (
    kind === "audiobook" &&
    (registered > 0 || removed > 0 || reprobed > 0 || !edition.offlineReady)
  ) {
    const registration = await registerBookChapters(editionId);
    if (registration.offlineReady) shouldEmitBookUpdate = true;
  }

  if (
    kind === "ebook" &&
    registered > 0 &&
    (await renameAudiobookChaptersFromEbook(edition.bookId))
  ) {
    shouldEmitBookUpdate = true;
  }

  if (shouldEmitBookUpdate) {
    emitBookUpdate(edition.bookId);
  }
  if (registered + refreshed > 0) {
    await notifyBookRequestAvailable(edition.bookId);
  }

  return { registered, refreshed, removed, directory };
}
