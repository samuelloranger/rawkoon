import {
  stat as statFile,
  readdir,
  rename as renameFile,
} from "node:fs/promises";
import { join, dirname, extname } from "node:path";
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
import {
  parseFilenameMetadata,
  parseReleaseSeasonEpisode,
  parseReleaseTitle,
} from "@rawkoon/api/utils/medias/filenameParser";
import { isExcludedDir } from "@rawkoon/api/utils/medias/fileIdentifier";
import { enqueuePostProcess } from "@rawkoon/api/services/downloadOutcome";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { reconcilePendingDownloads } from "@rawkoon/api/workers/checkDownloadCompletion";
import { classifyLanguageTags } from "@rawkoon/shared";
import type { LibraryAudioTrack } from "@rawkoon/shared";
import { renderMovieTemplate } from "@rawkoon/api/utils/medias/fileTemplate";
import { withKeyedLock } from "@rawkoon/api/utils/keyedLock";
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

const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".avi", ".m4v"]);
const SCAN_CONCURRENCY = 4;
const DB_WRITE_CONCURRENCY = 8;

function normalizeForDiscovery(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
    select: { id: true, mediaId: true, episodeId: true, torrentHash: true },
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
  const files = await prisma.mediaFile.findMany({ where: { mediaId } });
  const trackedPaths = new Set(files.map((f) => f.filePath));

  const toDeleteIds: number[] = [];
  const toUpdateOps: Array<() => Promise<unknown>> = [];
  let rescanned = 0;
  let skipped = 0;
  let failed = 0;
  const validEpisodeIds = new Set<number>();
  let hasValidFile = false;
  // Capture fresh MediaInfo + parsed filename data per file, so Step 1c
  // (rename) sees the post-rescan values rather than the stale row.
  type FreshFileMeta = {
    resolution: number | null;
    source: string | null;
    videoCodec: string | null;
  };
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
  // for any video file that fuzzy-matches this item's title+year but isn't
  // already tracked. Updates status to "downloaded" if it was "wanted".
  if (mediaSettings && media.type === "movie" && media.title) {
    const libraryPath = mediaSettings.moviesLibraryPath;
    if (libraryPath) {
      const remappedLibDir = remapPath(libraryPath);
      try {
        const entries = await readdir(remappedLibDir, { withFileTypes: true });
        const normalizedTitle = normalizeForDiscovery(media.title);
        const yearStr = media.year != null ? String(media.year) : null;

        const candidates: Array<{
          diskPath: string;
          dbPath: string;
          name: string;
        }> = [];
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const ext = extname(entry.name);
          if (!VIDEO_EXTENSIONS.has(ext)) continue;

          const stem = entry.name.slice(0, -ext.length);
          const normalized = normalizeForDiscovery(stem);
          if (!normalized.includes(normalizedTitle)) continue;
          if (yearStr != null && !normalized.includes(yearStr)) continue;

          const diskPath = join(remappedLibDir, entry.name);
          const dbPath = join(libraryPath, entry.name);
          if (trackedPaths.has(dbPath)) continue;
          candidates.push({ diskPath, dbPath, name: entry.name });
        }

        const created = await mapPool(
          candidates,
          SCAN_CONCURRENCY,
          async ({ diskPath, dbPath, name }) => {
            let st;
            try {
              st = await statFile(diskPath, { bigint: true });
            } catch {
              return false;
            }
            if (!st.isFile()) return false;
            const fp = fingerprintFromStats(st);
            const mi = await scanMediaInfo(diskPath);
            if (!mi) return false;

            const fnData = parseFilenameMetadata(name);
            await prisma.mediaFile.create({
              data: {
                mediaId,
                filePath: dbPath,
                fileName: name,
                ...fingerprintDbFields(fp),
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
                  null,
                ),
              },
            });
            trackedPaths.add(dbPath);
            return true;
          },
        );
        imported += created.filter(Boolean).length;
      } catch {
        // Library dir unreadable — skip discovery
      }

      if (imported > 0 && media.status === "wanted") {
        await prisma.libraryMedia.update({
          where: { id: mediaId },
          data: { status: "downloaded" },
        });
      }
    }
  }

  // ── Step 1b (shows): Discovery — scan the show dir for untracked episode files ─
  // Walk the configured shows library path for directories that fuzzy-match this
  // show's title, then match each untracked video file to a LibraryEpisode by its
  // SxxExx and insert a media_files row. Mirrors the movie discovery above; needed
  // because a mislinked/failed post-process can leave real episode files on disk
  // that never got tracked (e.g. an EEXIST collision).
  if (mediaSettings && media.type === "show" && media.title) {
    const libraryPath = mediaSettings.showsLibraryPath;
    if (libraryPath) {
      const remappedLibDir = remapPath(libraryPath);
      const normalizedTitle = normalizeForDiscovery(media.title);
      // Match the show folder exactly (optionally with a trailing year), not by
      // substring: a short title like "From" must not admit "Tales From the
      // Crypt" and pull that show's SxxExx files into the wrong library item.
      const showDirNames = new Set([normalizedTitle]);
      if (media.year != null) {
        showDirNames.add(`${normalizedTitle} ${media.year}`);
      }
      const episodes = await prisma.libraryEpisode.findMany({
        where: { mediaId },
        select: { id: true, season: true, episode: true, status: true },
      });
      const epByKey = new Map(
        episodes.map((e) => [`${e.season}x${e.episode}`, e]),
      );

      try {
        const showDirs = await readdir(remappedLibDir, { withFileTypes: true });
        for (const showEntry of showDirs) {
          if (!showEntry.isDirectory()) continue;
          if (!showDirNames.has(normalizeForDiscovery(showEntry.name)))
            continue;

          const showDiskDir = join(remappedLibDir, showEntry.name);
          const showDbDir = join(libraryPath, showEntry.name);
          // Recurse one level (Season folders) plus files directly under the show.
          const seasonEntries = await readdir(showDiskDir, {
            withFileTypes: true,
          });
          const scanDirs: Array<{ disk: string; db: string }> = [
            { disk: showDiskDir, db: showDbDir },
          ];
          for (const se of seasonEntries) {
            // Skip sidecar dirs (Sample, Extras, …) so a tagged sample video
            // inside them can't be imported as the real episode.
            if (se.isDirectory() && !isExcludedDir(se.name))
              scanDirs.push({
                disk: join(showDiskDir, se.name),
                db: join(showDbDir, se.name),
              });
          }

          for (const dir of scanDirs) {
            const fileEntries = await readdir(dir.disk, {
              withFileTypes: true,
            }).catch(() => []);
            const candidates: Array<{
              diskPath: string;
              dbPath: string;
              name: string;
              epId: number;
            }> = [];
            for (const entry of fileEntries) {
              if (!entry.isFile()) continue;
              const ext = extname(entry.name).toLowerCase();
              if (!VIDEO_EXTENSIONS.has(ext)) continue;

              const dbPath = join(dir.db, entry.name);
              if (trackedPaths.has(dbPath)) continue;

              if (parseReleaseTitle(entry.name).isSample) continue;
              const se = parseReleaseSeasonEpisode(entry.name);
              if (!se || se.episode == null) continue;
              const ep = epByKey.get(`${se.season}x${se.episode}`);
              if (!ep) continue;

              candidates.push({
                diskPath: join(dir.disk, entry.name),
                dbPath,
                name: entry.name,
                epId: ep.id,
              });
            }

            const created = await mapPool(
              candidates,
              SCAN_CONCURRENCY,
              async ({ diskPath, dbPath, name, epId }) => {
                let st;
                try {
                  st = await statFile(diskPath, { bigint: true });
                } catch {
                  return false;
                }
                if (!st.isFile()) return false;
                const fp = fingerprintFromStats(st);
                const mi = await scanMediaInfo(diskPath);
                if (!mi) return false;

                const fnData = parseFilenameMetadata(name);
                await prisma.mediaFile.create({
                  data: {
                    mediaId,
                    episodeId: epId,
                    filePath: dbPath,
                    fileName: name,
                    ...fingerprintDbFields(fp),
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
                      null,
                    ),
                  },
                });
                await prisma.libraryEpisode.update({
                  where: { id: epId },
                  data: { status: "downloaded", downloadedAt: new Date() },
                });
                validEpisodeIds.add(epId);
                // Intentionally do NOT set hasValidFile: it gates the requeue of
                // null-episode (season-pack / full-series) download histories.
                // Importing one orphaned episode must not suppress reprocessing a
                // still-present pack that could recover the remaining episodes;
                // per-episode histories are covered by validEpisodeIds above.
                trackedPaths.add(dbPath);
                return true;
              },
            );
            imported += created.filter(Boolean).length;
          }
        }
      } catch {
        // Library dir unreadable — skip discovery
      }
    }
  }

  // ── Step 1c: Rename — rename files that don't match the configured template ─
  // Skipped when fileOperation is "none" (manual placement) or when a download
  // is in progress (the post-processor will rename after hardlinking).
  if (
    mediaSettings &&
    media.type === "movie" &&
    mediaSettings.fileOperation !== "none" &&
    media.title
  ) {
    const activeDownloads = await prisma.downloadHistory.count({
      where: { mediaId, completedAt: null, failed: false },
    });
    if (activeDownloads === 0) {
      const survivingFiles = files.filter((f) => !toDeleteIds.includes(f.id));
      // Track destination paths claimed within this loop so two files
      // resolving to the same template stem don't clobber each other.
      const claimedTargets = new Set<string>();
      for (const file of survivingFiles) {
        const ext = extname(file.fileName);
        // Prefer post-rescan MediaInfo over the pre-update row, which may
        // hold stale or null values for resolution/source/codec.
        const fresh = freshMeta.get(file.id);
        const resolution = fresh?.resolution ?? file.resolution;
        const source = fresh?.source ?? file.source;
        const codec = fresh?.videoCodec ?? file.videoCodec;
        const res = resolution != null ? `${resolution}p` : null;
        const expectedStem = renderMovieTemplate(mediaSettings.movieTemplate, {
          title: media.title,
          year: media.year ?? null,
          resolution: res,
          source: source ?? null,
          codec: codec ?? null,
          ext: ext.slice(1),
        });
        const currentStem = file.fileName.slice(0, -ext.length);
        if (expectedStem === currentStem) continue;

        const newFileName = expectedStem + ext;
        const diskFrom = remapPath(file.filePath);
        const diskTo = join(dirname(diskFrom), newFileName);

        // Skip if another file in this same rescan already claimed the
        // target, or if a different file already exists on disk at it —
        // fs.rename on POSIX silently overwrites and we'd lose data.
        if (claimedTargets.has(diskTo)) continue;
        try {
          await statFile(diskTo);
          // Target already exists on disk — refuse to overwrite.
          continue;
        } catch {
          // ENOENT — safe to proceed.
        }

        await renameFile(diskFrom, diskTo);
        claimedTargets.add(diskTo);
        await prisma.mediaFile.update({
          where: { id: file.id },
          data: {
            filePath: join(dirname(file.filePath), newFileName),
            fileName: newFileName,
          },
        });
        renamed++;
      }
    }
  }

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
