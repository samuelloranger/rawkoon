import { stat as statFile } from "node:fs/promises";
import { prisma } from "@rawkoon/api/db";
import {
  scanMediaInfo,
  remapPath,
} from "@rawkoon/api/utils/medias/mediainfoScanner";
import {
  fileUnchanged,
  fingerprintDbFields,
  fingerprintFromStats,
  mapPool,
} from "@rawkoon/api/utils/medias/fileFingerprint";
import { parseFilenameMetadata } from "@rawkoon/api/utils/medias/filenameParser";
import { enqueuePostProcess } from "@rawkoon/api/services/downloads/downloadOutcome";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { reconcilePendingDownloads } from "@rawkoon/api/workers/checkDownloadCompletion";
import { withKeyedLock } from "@rawkoon/api/utils/keyedLock";
import {
  discoverMovieFiles,
  discoverShowEpisodes,
} from "@rawkoon/api/services/library/rescanDiscovery";
import {
  renameFilesToTemplate,
  type FreshFileMeta,
} from "@rawkoon/api/services/library/rescanRename";
import { PERF_TIMING_ENABLED } from "@rawkoon/api/services/perf/perfStore";

export type RescanResult = {
  rescanned: number; // files whose MediaInfo was updated
  skipped: number; // unchanged files (fingerprint match) — MediaInfo not re-run
  failed: number; // files that exist on disk but MediaInfo failed to read
  deleted: number; // stale MediaFile records removed (file gone from disk)
  imported: number; // files discovered in library dir and newly tracked
  renamed: number; // files renamed on disk to match the configured template
  requeued: number; // post-process jobs queued (file in downloads, not yet hardlinked)
  episodesReset: number; // LibraryEpisode rows reset to "wanted"
  mediaReset: boolean; // whether LibraryMedia.status was reset to "wanted"
  pendingReconciled: {
    completed: number;
    failed: number;
    missing: number;
  };
};

const SCAN_CONCURRENCY = 4;
const DB_WRITE_CONCURRENCY = 8;

export async function rescanLibraryItem(
  mediaId: number,
): Promise<RescanResult | null> {
  // Serialize concurrent rescans of the same item so the file-rename step
  // can't have two runs pass the overwrite guard and clobber each other.
  return withKeyedLock(`rescan:${mediaId}`, () => {
    if (!PERF_TIMING_ENABLED) return rescanLibraryItemInner(mediaId);
    // Perf-baseline: wall-clock the library rescan (readdir walk + MediaInfo),
    // logged like scheduledTasksWorker.ts. No-op unless the flag is set.
    const startedAt = Date.now();
    return rescanLibraryItemInner(mediaId).finally(() => {
      console.log(
        `[perf] rescanLibraryItem(${mediaId}) completed in ${Date.now() - startedAt}ms`,
      );
    });
  });
}

async function rescanLibraryItemInner(
  mediaId: number,
): Promise<RescanResult | null> {
  const media = await prisma.libraryMedia.findUnique({
    where: { id: mediaId },
    include: {
      downloadHistories: {
        where: { failed: false, completedAt: { not: null } },
        select: { id: true, torrentHash: true, episodeId: true },
      },
    },
  });
  if (!media) return null;

  // ── Step 0: Reconcile pending rows against the active download client ──
  // If the item is stuck in "downloading" because the torrent was deleted or
  // errored out, mark the download_history failed and revert status so the
  // rescan can re-evaluate from "wanted". Missing torrents are treated as
  // failed to unstick the UI.
  const pendingDhs = await prisma.downloadHistory.findMany({
    where: { mediaId, completedAt: null, failed: false },
    select: {
      id: true,
      mediaId: true,
      episodeId: true,
      torrentHash: true,
      releaseTitle: true,
      indexer: true,
    },
  });
  const pendingReconciled = await reconcilePendingDownloads(pendingDhs, {
    treatMissingAsFailed: true,
  });

  const mediaSettings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
  });

  let imported = 0;
  let renamed = 0;

  // ── Step 1: Process existing MediaFile records ────────────────────────────────
  // Update MediaInfo for valid files; delete records for files gone from disk.
  // Skip MediaInfo when size+mtime fingerprint matches the last scan.
  const allFiles = await prisma.mediaFile.findMany({ where: { mediaId } });
  const trackedPaths = new Set(allFiles.map((f) => f.filePath));
  // A file mid re-encode may be briefly absent (renamed aside during a cross-device swap); leave it to the pipeline.
  const transcoding = new Set(
    (
      await prisma.transcodeJob.findMany({
        where: {
          status: "running",
          mediaFileId: { in: allFiles.map((f) => f.id) },
        },
        select: { mediaFileId: true },
      })
    ).map((j) => j.mediaFileId),
  );
  const files = allFiles.filter((f) => !transcoding.has(f.id));

  const toDeleteIds: number[] = [];
  const toUpdateOps: Array<() => Promise<unknown>> = [];
  let rescanned = 0;
  let skipped = 0;
  let failed = 0;
  const validEpisodeIds = new Set<number>();
  let hasValidFile = transcoding.size > 0;
  for (const f of allFiles)
    if (transcoding.has(f.id) && f.episodeId) validEpisodeIds.add(f.episodeId);
  // Fresh MediaInfo per file, so Step 1c (rename) sees post-rescan values.
  const freshMeta = new Map<number, FreshFileMeta>();

  await mapPool(files, SCAN_CONCURRENCY, async (file) => {
    const mapped = remapPath(file.filePath);
    let st;
    try {
      st = await statFile(mapped, { bigint: true });
    } catch {
      toDeleteIds.push(file.id);
      return;
    }
    if (!st.isFile()) {
      toDeleteIds.push(file.id);
      return;
    }

    const fp = fingerprintFromStats(st);
    hasValidFile = true;
    if (file.episodeId != null) validEpisodeIds.add(file.episodeId);

    if (
      fileUnchanged(
        {
          sizeBytes: file.sizeBytes,
          fileMtimeMs: file.fileMtimeMs,
        },
        fp,
      )
    ) {
      freshMeta.set(file.id, {
        resolution: file.resolution,
        source: file.source,
        videoCodec: file.videoCodec,
      });
      // Backfill inode columns if an older row only has mtime/size.
      if (file.fileDev == null || file.fileIno == null) {
        toUpdateOps.push(() =>
          prisma.mediaFile.update({
            where: { id: file.id },
            data: fingerprintDbFields(fp),
          }),
        );
      }
      skipped++;
      return;
    }

    const mi = await scanMediaInfo(file.filePath);
    if (!mi) {
      // File is on disk but MediaInfo can't read it (corrupt / unsupported format)
      failed++;
      // Still persist fingerprint so the next pass can skip a doomed re-scan
      // only after a successful MediaInfo — keep failed files eligible to retry.
      return;
    }

    const fnData = parseFilenameMetadata(file.fileName);
    freshMeta.set(file.id, {
      resolution: mi.resolution ?? fnData.resolution,
      source: mi.source ?? fnData.source,
      videoCodec: mi.videoCodec,
    });
    toUpdateOps.push(() =>
      prisma.mediaFile.update({
        where: { id: file.id },
        data: {
          ...fingerprintDbFields(fp),
          durationSecs: mi.durationSecs,
          releaseGroup: file.releaseGroup ?? mi.releaseGroup,
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
          scannedAt: new Date(),
        },
      }),
    );
    rescanned++;
  });

  const deleted = toDeleteIds.length;
  if (toDeleteIds.length > 0) {
    await prisma.mediaFile.deleteMany({ where: { id: { in: toDeleteIds } } });
  }
  await mapPool(toUpdateOps, DB_WRITE_CONCURRENCY, (op) => op());

  // ── Step 1b: Discovery — scan library dir for untracked video files ────────
  // Walk the configured movies/shows library path and insert a media_files row
  // for any video file whose name contains this item's title and year as whole
  // words and that no library item tracks yet. Updates status to "downloaded"
  // if it was "wanted".
  imported += await discoverMovieFiles({
    media,
    mediaSettings,
    mediaId,
    trackedPaths,
  });

  // ── Step 1b (shows): Discovery — scan the show dir for untracked episode files ─
  // Walk the configured shows library path for directories that fuzzy-match this
  // show's title, then match each untracked video file to a LibraryEpisode by its
  // SxxExx and insert a media_files row. Mirrors the movie discovery above; needed
  // because a mislinked/failed post-process can leave real episode files on disk
  // that never got tracked (e.g. an EEXIST collision).
  imported += await discoverShowEpisodes({
    media,
    mediaSettings,
    mediaId,
    trackedPaths,
    validEpisodeIds,
  });
  if (imported > 0) {
    // Newly tracked files can complete a title whose request is waiting.
    const { recheckRequestAvailable } = await import(
      "@rawkoon/api/services/mediaRequestNotifications"
    );
    await recheckRequestAvailable(mediaId);
  }

  // ── Step 1c: Rename — rename files that don't match the configured template ─
  // Skipped when fileOperation is "none" (manual placement) or when a download
  // is in progress (the post-processor will rename after hardlinking).
  renamed += await renameFilesToTemplate({
    media,
    mediaSettings,
    mediaId,
    files,
    toDeleteIds,
    freshMeta,
  });

  // ── Step 2: re-queue post-processing for completed client downloads ────
  // Handles the case where a torrent finished downloading but the hardlink/move
  // step was missed. Only fires if the torrent is still present in the client
  // in a completed state, so intentionally-deleted torrents are never re-queued.
  let requeued = 0;
  const completedDhs = media.downloadHistories.filter((dh) => dh.torrentHash);

  if (completedDhs.length > 0) {
    const completeHashes = new Set<string>();
    try {
      const active = await resolveActiveAdapter();
      if (active) {
        const torrents = await active.adapter.listTorrents();
        for (const torrent of torrents) {
          if (torrent.state === "completed" || torrent.progress >= 1)
            completeHashes.add(torrent.hash.toLowerCase());
        }
      }
    } catch {
      // Download client unreachable — skip re-queue.
    }

    for (const dh of completedDhs) {
      if (!dh.torrentHash) continue;
      if (!completeHashes.has(dh.torrentHash.toLowerCase())) continue;

      // Re-queue only if the target file is actually missing from the library
      const needsRequeue =
        dh.episodeId != null
          ? !validEpisodeIds.has(dh.episodeId)
          : !hasValidFile;

      if (needsRequeue) {
        // force: recovery for a file that never landed. A retained completed
        // job for this row would otherwise swallow the add while we report it
        // as requeued.
        await enqueuePostProcess(dh.id, { force: true });
        requeued++;
      }
    }
  }

  // ── Step 3: Reconcile statuses ────────────────────────────────────────────────
  // Skip if a post-processing job was just requeued (it completes asynchronously).
  let episodesReset = 0;
  let mediaReset = false;

  // The per-episode reset only touches episodes with no files, so a discovery
  // import (which gives its episode a file) never resets what it just imported.
  // Gate it on `requeued` only — not `imported` — so importing one orphaned
  // episode doesn't leave the show's other missing episodes stuck as
  // downloaded/upgrading.
  if (requeued === 0 && media.type === "show") {
    const result = await prisma.libraryEpisode.updateMany({
      where: {
        mediaId,
        status: { notIn: ["wanted", "skipped"] },
        files: { none: {} },
      },
      data: { status: "wanted", searchAttempts: 0, downloadedAt: null },
    });
    episodesReset = result?.count ?? 0;
  }

  if (imported === 0 && requeued === 0) {
    const remainingFiles = await prisma.mediaFile.count({ where: { mediaId } });
    if (
      remainingFiles === 0 &&
      media.status !== "wanted" &&
      media.status !== "skipped"
    ) {
      await prisma.libraryMedia.update({
        where: { id: mediaId },
        data: { status: "wanted", searchAttempts: 0 },
      });
      mediaReset = true;
    }
  }

  return {
    rescanned,
    skipped,
    failed,
    deleted,
    imported,
    renamed,
    requeued,
    episodesReset,
    mediaReset,
    pendingReconciled,
  };
}
