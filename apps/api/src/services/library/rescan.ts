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
  parseFilenameMetadata,
  parseReleaseSeasonEpisode,
  parseReleaseTitle,
} from "@rawkoon/api/utils/medias/filenameParser";
import { isExcludedDir } from "@rawkoon/api/utils/medias/fileIdentifier";
import { enqueueLibraryPostProcess } from "@rawkoon/api/services/postProcessorQueue";
import { getQbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/config";
import { fetchMaindata } from "@rawkoon/api/services/qbittorrent/clientFetch";
import {
  isCompletedDownloadState,
  reconcilePendingDownloads,
} from "@rawkoon/api/workers/checkDownloadCompletion";
import { classifyLanguageTags } from "@rawkoon/shared";
import type { LibraryAudioTrack } from "@rawkoon/shared";
import { renderMovieTemplate } from "@rawkoon/api/utils/medias/fileTemplate";
import { withKeyedLock } from "@rawkoon/api/utils/keyedLock";

export type RescanResult = {
  rescanned: number; // files whose MediaInfo was updated
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
  return withKeyedLock(`rescan:${mediaId}`, () =>
    rescanLibraryItemInner(mediaId),
  );
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

  // ── Step 0: Reconcile pending download_history rows against qBittorrent ──
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
  const files = await prisma.mediaFile.findMany({ where: { mediaId } });
  const trackedPaths = new Set(files.map((f) => f.filePath));

  const toDeleteIds: number[] = [];
  const toUpdateOps: Array<() => Promise<unknown>> = [];
  let rescanned = 0;
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

  const SCAN_CONCURRENCY = 4;
  for (let i = 0; i < files.length; i += SCAN_CONCURRENCY) {
    const chunk = files.slice(i, i + SCAN_CONCURRENCY);
    await Promise.all(
      chunk.map(async (file) => {
        const mi = await scanMediaInfo(file.filePath);
        if (!mi) {
          try {
            await statFile(remapPath(file.filePath));
            // File is on disk but MediaInfo can't read it (corrupt / unsupported format)
            failed++;
            hasValidFile = true;
            if (file.episodeId != null) validEpisodeIds.add(file.episodeId);
          } catch {
            toDeleteIds.push(file.id);
          }
          return;
        }

        hasValidFile = true;
        if (file.episodeId != null) validEpisodeIds.add(file.episodeId);

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
              sizeBytes: mi.sizeBytes,
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
            },
          }),
        );
        rescanned++;
      }),
    );
  }

  const deleted = toDeleteIds.length;
  if (toDeleteIds.length > 0) {
    await prisma.mediaFile.deleteMany({ where: { id: { in: toDeleteIds } } });
  }
  await Promise.all(toUpdateOps.map((op) => op()));

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

          const mi = await scanMediaInfo(diskPath);
          if (!mi) continue;

          const fnData = parseFilenameMetadata(entry.name);
          await prisma.mediaFile.create({
            data: {
              mediaId,
              filePath: dbPath,
              fileName: entry.name,
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
                null,
              ),
            },
          });
          imported++;
          trackedPaths.add(dbPath);
        }
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

              const mi = await scanMediaInfo(join(dir.disk, entry.name));
              if (!mi) continue;

              const fnData = parseFilenameMetadata(entry.name);
              await prisma.mediaFile.create({
                data: {
                  mediaId,
                  episodeId: ep.id,
                  filePath: dbPath,
                  fileName: entry.name,
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
                    null,
                  ),
                },
              });
              await prisma.libraryEpisode.update({
                where: { id: ep.id },
                data: { status: "downloaded", downloadedAt: new Date() },
              });
              validEpisodeIds.add(ep.id);
              // Intentionally do NOT set hasValidFile: it gates the requeue of
              // null-episode (season-pack / full-series) download histories.
              // Importing one orphaned episode must not suppress reprocessing a
              // still-present pack that could recover the remaining episodes;
              // per-episode histories are covered by validEpisodeIds above.
              imported++;
              trackedPaths.add(dbPath);
            }
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

  // ── Step 2: qBittorrent — re-queue post-processing for completed downloads ────
  // Handles the case where a torrent finished downloading but the hardlink/move
  // step was missed. Only fires if the torrent is still present in qBittorrent
  // in a completed state, so intentionally-deleted torrents are never re-queued.
  let requeued = 0;
  const completedDhs = media.downloadHistories.filter((dh) => dh.torrentHash);

  if (completedDhs.length > 0) {
    const qbCompleteHashes = new Set<string>();
    try {
      const qbCfg = await getQbittorrentIntegrationConfig();
      if (qbCfg.enabled && qbCfg.config) {
        const { torrents } = await fetchMaindata(qbCfg.config);
        for (const [hash, raw] of torrents) {
          const state = typeof raw.state === "string" ? raw.state : "";
          const progress =
            typeof raw.progress === "number" && Number.isFinite(raw.progress)
              ? raw.progress
              : 0;
          if (isCompletedDownloadState(state) || progress >= 1) {
            qbCompleteHashes.add(hash.toLowerCase());
          }
        }
      }
    } catch {
      // qBittorrent unreachable — skip re-queue
    }

    for (const dh of completedDhs) {
      if (!dh.torrentHash) continue;
      if (!qbCompleteHashes.has(dh.torrentHash.toLowerCase())) continue;

      // Re-queue only if the target file is actually missing from the library
      const needsRequeue =
        dh.episodeId != null
          ? !validEpisodeIds.has(dh.episodeId)
          : !hasValidFile;

      if (needsRequeue) {
        enqueueLibraryPostProcess(dh.id);
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
