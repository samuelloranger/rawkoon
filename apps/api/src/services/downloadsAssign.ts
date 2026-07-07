import { copyFile, link, mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";
import {
  invalidateDownloadsScannerCache,
  invalidateLibraryInodeKeySetCache,
  deriveDownloadsScanRoots,
  pathIsInsideRoot,
  buildLibraryInodeKeySet,
  DOWNLOADS_MIN_BYTES,
} from "@rawkoon/api/services/downloadsScanner";
import { addOrUpdateLibraryFromTmdb } from "@rawkoon/api/services/libraryFromTmdb";
import { emitLibraryUpdate } from "@rawkoon/api/services/libraryEvents";
import { triggerJellyfinLibraryScan } from "@rawkoon/api/services/jellyfinLibraryRefresh";
import {
  parseFilenameMetadata,
  parseReleaseSeasonEpisode,
  parseReleaseTitle,
} from "@rawkoon/api/utils/medias/filenameParser";
import {
  renderEpisodeTemplate,
  renderMovieTemplate,
  sanitizeFilenamePart,
  sanitizePathTemplateOutput,
} from "@rawkoon/api/utils/medias/fileTemplate";
import { resolveDownloadedStatus } from "@rawkoon/api/utils/medias/libraryHelpers";
import { withKeyedLock } from "@rawkoon/api/utils/keyedLock";
import {
  remapPath,
  scanMediaInfo,
} from "@rawkoon/api/utils/medias/mediainfoScanner";

export type AssignDownloadInput = {
  file_path: string;
  tmdb_id: number;
  kind: "movie" | "tv";
  season?: number;
  episode?: number;
};

export type AssignDownloadSuccess = {
  library_media_id: number;
  media_file_id: number;
};

function asInodeParts(st: import("node:fs").Stats): {
  dev: number;
  ino: number;
} {
  const devUnknown = st.dev as unknown;
  const inoUnknown = st.ino as unknown;
  return {
    dev:
      typeof devUnknown === "bigint"
        ? Number(devUnknown)
        : Number(devUnknown as number),
    ino:
      typeof inoUnknown === "bigint"
        ? Number(inoUnknown)
        : Number(inoUnknown as number),
  };
}

function inodeMatch(
  a: { dev: number; ino: number },
  b: { dev: number; ino: number },
): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function qualityFromVideoBasename(videoBase: string) {
  const stem = basename(videoBase, extname(videoBase));
  const pr = parseReleaseTitle(stem);
  return {
    resolution: pr.resolution != null ? `${pr.resolution}p` : null,
    source: pr.source,
    codec: pr.codec,
  };
}

async function mkdirForFile(dstMapped: string): Promise<void> {
  await mkdir(dirname(dstMapped), { recursive: true });
}

async function placeSourceToDestination(
  srcMapped: string,
  dstMapped: string,
  op: "hardlink" | "move",
): Promise<void> {
  if (op === "move") {
    await mkdirForFile(dstMapped);
    try {
      await rename(srcMapped, dstMapped);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        await copyFile(srcMapped, dstMapped);
        await unlink(srcMapped);
      } else throw e;
    }
    return;
  }

  await mkdirForFile(dstMapped);
  try {
    await link(srcMapped, dstMapped);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EXDEV") await copyFile(srcMapped, dstMapped);
    else throw e;
  }
}

async function readFileInode(mappedPath: string): Promise<{
  dev: number;
  ino: number;
} | null> {
  try {
    const st = await stat(mappedPath);
    if (!st.isFile()) return null;
    return asInodeParts(st);
  } catch {
    return null;
  }
}

/** Classify what's at `destination` before we mutate it */
async function classifyDestForAssign(
  destMapped: string,
  srcIno: { dev: number; ino: number },
): Promise<
  | { kind: "absent" }
  | { kind: "same_hardlink_as_source" }
  | { kind: "collision_other_file" }
> {
  const stDest = await readFileInode(destMapped);
  if (!stDest) return { kind: "absent" };
  if (inodeMatch(stDest, srcIno)) return { kind: "same_hardlink_as_source" };
  return { kind: "collision_other_file" };
}

async function persistMediaAndStatuses(opts: {
  destinationPathHost: string;
  mediaId: number;
  episodeId: number | null;
  releaseStemForLanguages: string;
  libraryRow: {
    id: number;
    type: string;
    tmdbStatus: string | null;
  };
}) {
  const destMapped = remapPath(opts.destinationPathHost);
  const destBase = basename(opts.destinationPathHost);
  const fnData = parseFilenameMetadata(destBase);
  const mi = await scanMediaInfo(destMapped).catch(() => null);

  const fileDataMi = mi
    ? {
        mediaId: opts.mediaId,
        episodeId: opts.episodeId,
        filePath: opts.destinationPathHost,
        fileName: destBase,
        sizeBytes: mi.sizeBytes,
        durationSecs: mi.durationSecs,
        releaseGroup: mi.releaseGroup,
        videoCodec: mi.videoCodec,
        videoProfile: mi.videoProfile,
        width: mi.width,
        height: mi.height,
        frameRate: mi.frameRate,
        bitDepth: mi.bitDepth,
        videoBitrate: mi.videoBitrate,
        hdrFormat: mi.hdrFormat ?? fnData.hdrFormat,
        resolution: mi.resolution ?? fnData.resolution,
        source: mi.source ?? fnData.source,
        audioTracks: mi.audioTracks as object[],
        subtitleTracks: mi.subtitleTracks as object[],
        languageTags: classifyLanguageTags(
          mi.audioTracks as LibraryAudioTrack[],
          opts.releaseStemForLanguages,
        ),
      }
    : {
        mediaId: opts.mediaId,
        episodeId: opts.episodeId,
        filePath: opts.destinationPathHost,
        fileName: destBase,
        sizeBytes: BigInt((await stat(destMapped)).size),
        durationSecs: null as number | null,
        releaseGroup: null as string | null,
        resolution: fnData.resolution,
        source: fnData.source ?? null,
        hdrFormat: fnData.hdrFormat,
        audioTracks: [] as object[],
        subtitleTracks: [] as object[],
        languageTags: [] as string[],
        videoCodec: null as string | null,
        videoProfile: null as string | null,
        width: null as number | null,
        height: null as number | null,
        frameRate: null as number | null,
        bitDepth: null as number | null,
        videoBitrate: null as number | null,
      };

  const existing = await prisma.mediaFile.findFirst({
    where: { filePath: opts.destinationPathHost },
    select: { id: true },
  });

  let mfRow: { id: number };
  if (existing) {
    mfRow = await prisma.mediaFile.update({
      where: { id: existing.id },
      data: fileDataMi,
      select: { id: true },
    });
  } else {
    mfRow = await prisma.mediaFile.create({
      data: fileDataMi,
      select: { id: true },
    });
  }

  if (opts.episodeId != null) {
    await prisma.libraryEpisode.update({
      where: { id: opts.episodeId },
      data: { status: "downloaded", downloadedAt: new Date() },
    });
  }

  await prisma.libraryMedia.update({
    where: { id: opts.mediaId },
    data: {
      status: resolveDownloadedStatus(
        opts.libraryRow.type,
        opts.libraryRow.tmdbStatus,
      ),
    },
  });

  return mfRow;
}

export async function assignDownloadFromDisk(
  input: AssignDownloadInput,
): Promise<AssignDownloadSuccess | { error: string; status: number }> {
  const settings = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  if (!settings) return { status: 500, error: "Media settings missing" };
  if (!settings.postProcessingEnabled)
    return { status: 400, error: "Post-processing is disabled in settings" };

  const abs = resolve(input.file_path);
  const srcMapped = remapPath(abs);
  let srcStat;
  try {
    srcStat = await stat(srcMapped);
  } catch {
    return { status: 404, error: "File not found" };
  }

  if (!srcStat.isFile()) return { status: 400, error: "Path is not a file" };

  const sz =
    typeof srcStat.size === "bigint"
      ? Number(srcStat.size)
      : Math.trunc(Number(srcStat.size));
  if (sz < DOWNLOADS_MIN_BYTES)
    return { status: 400, error: "File is below minimum size threshold" };

  const downloadsRootsHost = deriveDownloadsScanRoots(settings);
  if (
    downloadsRootsHost.length === 0 ||
    !downloadsRootsHost.some((r) => pathIsInsideRoot(abs, r))
  ) {
    return { status: 400, error: "file_path must be inside a downloads root" };
  }

  const inodeSet = await buildLibraryInodeKeySet();
  const srcIno = asInodeParts(srcStat);
  if (inodeSet.has(`${srcIno.dev}:${srcIno.ino}`))
    return {
      status: 409,
      error: "File is already linked in the library (inode match)",
    };

  let season =
    typeof input.season === "number" && Number.isFinite(input.season)
      ? Math.trunc(input.season)
      : null;
  let episodeNum =
    typeof input.episode === "number" && Number.isFinite(input.episode)
      ? Math.trunc(input.episode)
      : null;
  const stemForSe = basename(abs).replace(/\.[^.]+$/, "");
  const seEp = parseReleaseSeasonEpisode(stemForSe);
  if (season == null && seEp?.season != null) season = seEp.season;
  if (episodeNum == null && seEp?.episode != null) episodeNum = seEp.episode;

  let library;
  try {
    library = await addOrUpdateLibraryFromTmdb({
      tmdb_id: input.tmdb_id,
      type: input.kind === "movie" ? "movie" : "show",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "TMDB lookup failed";
    return { status: 422, error: msg };
  }

  if (input.kind === "movie" && library.type !== "movie") {
    return { status: 422, error: "TMDB id is not a movie" };
  }
  if (input.kind === "tv" && library.type !== "show") {
    return { status: 422, error: "TMDB id is not a TV show" };
  }

  let episodeRow: { id: number; title: string | null } | null = null;
  if (input.kind === "tv") {
    if (season == null || episodeNum == null) {
      return {
        status: 422,
        error: "Season and episode are required for television assignments",
      };
    }
    episodeRow = await prisma.libraryEpisode.findUnique({
      where: {
        mediaId_season_episode: {
          mediaId: library.id,
          season,
          episode: episodeNum,
        },
      },
      select: { id: true, title: true },
    });
    if (!episodeRow)
      return {
        status: 422,
        error: "Episode is not listed for this show after TMDB refresh",
      };
  }

  const moviesRootConfigured = settings.moviesLibraryPath?.trim();
  const showsRootConfigured = settings.showsLibraryPath?.trim();
  const op = settings.fileOperation === "move" ? "move" : "hardlink";
  const ext = extname(abs) || ".mkv";
  const q = qualityFromVideoBasename(basename(abs));

  let destinationHost: string;

  if (input.kind === "movie") {
    if (!moviesRootConfigured)
      return { status: 400, error: "Movies library path is not configured" };

    const existingTracked = await prisma.mediaFile.findFirst({
      where: { mediaId: library.id, episodeId: null },
      select: { filePath: true },
    });

    const moviesLibRoot = moviesRootConfigured.replace(/\/+$/, "");
    const stem =
      renderMovieTemplate(settings.movieTemplate, {
        title: library.title,
        year: library.year,
        resolution: q.resolution,
        source: q.source,
        codec: q.codec,
        ext,
      }) || sanitizeFilenamePart(library.title);
    destinationHost = join(moviesLibRoot, `${stem}${ext}`);

    if (existingTracked) {
      const otherIno = await readFileInode(remapPath(existingTracked.filePath));
      if (
        otherIno &&
        resolve(existingTracked.filePath) !== resolve(destinationHost) &&
        inodeMatch(otherIno, srcIno)
      ) {
        return {
          status: 409,
          error:
            "This download is already hardlinked elsewhere for this library movie",
        };
      }
      if (
        otherIno &&
        resolve(existingTracked.filePath) !== resolve(destinationHost) &&
        !inodeMatch(otherIno, srcIno)
      ) {
        return {
          status: 409,
          error:
            "This movie already has a different tracked file — remove it before replacing",
        };
      }
    }
  } else {
    if (!showsRootConfigured)
      return { status: 400, error: "Shows library path is not configured" };

    const epId = episodeRow!.id;
    const existingEpisodeFile = await prisma.mediaFile.findFirst({
      where: { episodeId: epId },
      select: { filePath: true },
    });

    const showsLibRoot = showsRootConfigured.replace(/\/+$/, "");
    const epStem =
      renderEpisodeTemplate(settings.episodeTemplate, {
        show: library.title,
        season: season!,
        episode: episodeNum!,
        title: episodeRow!.title ?? "Episode",
        resolution: q.resolution,
        source: q.source,
        ext,
      }) ||
      sanitizePathTemplateOutput(
        `${library.title}/Season ${season}/${library.title} - S${String(season).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`,
      );
    destinationHost = join(showsLibRoot, `${epStem}${ext}`);

    if (existingEpisodeFile) {
      const otherIno = await readFileInode(
        remapPath(existingEpisodeFile.filePath),
      );
      if (
        otherIno &&
        resolve(existingEpisodeFile.filePath) !== resolve(destinationHost) &&
        inodeMatch(otherIno, srcIno)
      ) {
        return {
          status: 409,
          error: "This download is already linked for this episode",
        };
      }
      if (
        otherIno &&
        resolve(existingEpisodeFile.filePath) !== resolve(destinationHost) &&
        !inodeMatch(otherIno, srcIno)
      ) {
        return {
          status: 409,
          error:
            "This episode already has a different tracked file — remove it before replacing",
        };
      }
    }
  }

  const dstMapped = remapPath(destinationHost);

  // Serialize placement per destination so the classify -> rename/link window
  // can't be raced by a concurrent assign clobbering a file at the same path.
  return withKeyedLock(`assign:${dstMapped}`, async () => {
    const destClass = await classifyDestForAssign(dstMapped, srcIno);

    if (destClass.kind === "collision_other_file") {
      return {
        status: 409,
        error: "Destination path is occupied by a different file",
      };
    }

    try {
      if (destClass.kind === "absent") {
        await placeSourceToDestination(srcMapped, dstMapped, op);
      }
      /** `same_hardlink_as_source`: destination already aliases the download file */

      const post = await classifyDestForAssign(dstMapped, srcIno);
      if (post.kind === "collision_other_file") {
        return { status: 409, error: "Destination collision during placement" };
      }
      if (post.kind === "absent") {
        return { status: 500, error: "Destination missing after placement" };
      }

      const mfRow = await persistMediaAndStatuses({
        destinationPathHost: destinationHost,
        mediaId: library.id,
        episodeId: input.kind === "tv" ? episodeRow!.id : null,
        releaseStemForLanguages: basename(abs),
        libraryRow: {
          id: library.id,
          type: library.type,
          tmdbStatus: library.tmdbStatus ?? null,
        },
      });

      invalidateDownloadsScannerCache();
      // The just-created MediaFile adds a new inode to the library; drop the
      // cached inode set so the next scan/assignment sees it (hardlink dedup).
      invalidateLibraryInodeKeySetCache();
      emitLibraryUpdate(library.id);
      void triggerJellyfinLibraryScan();

      return {
        library_media_id: library.id,
        media_file_id: mfRow.id,
      };
    } catch (e) {
      try {
        if (destClass.kind === "absent") await unlink(dstMapped);
      } catch {
        /* ignore */
      }
      const msg = e instanceof Error ? e.message : "Assignment failed";
      return { status: 500, error: msg };
    }
  });
}
