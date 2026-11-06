import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import type { ParsedQualityFields } from "@rawkoon/shared/types";

import { prisma } from "@rawkoon/api/db";
import { revertToWantedIfNoActiveGrabs } from "@rawkoon/api/services/downloads/downloadOutcome";
import { estimateEtaSeconds } from "@rawkoon/api/services/downloadClient/eta";
import { pruneLibraryDirsAfterDelete } from "@rawkoon/api/services/library/pruneLibraryDirs";

/** Newest grabs shown in the library detail history panel. */
const MEDIA_HISTORY_LIMIT = 200;

export type LiveDownload = {
  progress: number;
  download_speed: number;
  eta_seconds: number | null;
  state: string;
  /** Connected seeds and peers right now. */
  seeds: number;
  peers: number;
};

async function mediaExists(id: number): Promise<boolean> {
  const media = await prisma.libraryMedia.findUnique({ where: { id } });
  return media !== null;
}

/** Episodes of a library item, or null when the item does not exist. */
export async function listEpisodesForMedia(id: number) {
  if (!(await mediaExists(id))) return null;
  return prisma.libraryEpisode.findMany({
    where: { mediaId: id },
    orderBy: [{ season: "asc" }, { episode: "asc" }],
  });
}

/** Grab history plus best-effort live client numbers; null when the item is missing. */
export async function getDownloadHistoryWithLive(id: number) {
  if (!(await mediaExists(id))) return null;

  const items = await prisma.downloadHistory.findMany({
    where: { mediaId: id },
    orderBy: { grabbedAt: "desc" },
    // Newest-first cap: a long-running upgrade loop can accumulate hundreds
    // of grabs for one title, and the detail panel only renders recent ones.
    take: MEDIA_HISTORY_LIMIT,
  });

  // Released torrents use their stored size; held torrents provide current stats.
  const pollableHashes = items
    .filter((h) => h.torrentHash && !h.seedReleasedAt)
    .map((h) => (h.torrentHash as string).toLowerCase());
  const inFlight = new Set(
    items
      .filter((h) => !h.completedAt && !h.failed && h.torrentHash)
      .map((h) => (h.torrentHash as string).toLowerCase()),
  );
  const torrentByHash = new Map<string, NormalizedTorrent>();
  const liveByHash = new Map<string, LiveDownload>();

  if (pollableHashes.length > 0) {
    const { resolveActiveAdapter } = await import(
      "@rawkoon/api/services/downloadClient/registry"
    );
    const active = await resolveActiveAdapter();
    if (active) {
      try {
        const torrents = await active.adapter.listTorrents();
        const pollable = new Set(pollableHashes);
        for (const torrent of torrents) {
          const key = torrent.hash.toLowerCase();
          if (!pollable.has(key)) continue;
          torrentByHash.set(key, torrent);
          if (!inFlight.has(key)) continue;
          liveByHash.set(key, {
            progress: torrent.progress,
            download_speed: torrent.dlSpeed,
            eta_seconds: estimateEtaSeconds(torrent),
            state: torrent.state,
            seeds: torrent.seeds,
            peers: torrent.peers,
          });
        }
      } catch {
        // Client unavailable: keep live progress null.
      }
    }
  }

  return { items, torrentByHash, liveByHash };
}

/** Row size: the client's torrent while it holds it, else the size stamped at release. */
export function sizeBytesForRow(
  row: { seedReleasedBytes: bigint | null },
  torrent: NormalizedTorrent | undefined,
): number | null {
  if (torrent && torrent.sizeBytes > 0) return torrent.sizeBytes;
  return row.seedReleasedBytes != null ? Number(row.seedReleasedBytes) : null;
}

/** Parsed quality of a stored `qualityParsed` JSON, tolerating older shapes; null when unusable. */
export function parsedQualityFromStored(
  json: unknown,
): ParsedQualityFields | null {
  if (json == null || typeof json !== "object") return null;
  const q = json as Record<string, unknown>;
  const rawResolution = q.resolution;
  const resolution =
    typeof rawResolution === "number"
      ? rawResolution
      : typeof rawResolution === "string" && /^\d{3,4}p?$/i.test(rawResolution)
        ? Number.parseInt(rawResolution, 10)
        : null;
  const source = typeof q.source === "string" ? q.source : null;
  const codec = typeof q.codec === "string" ? q.codec : null;
  const hdr = typeof q.hdr === "string" ? q.hdr : null;
  if (resolution == null && source == null && codec == null && hdr == null) {
    return null;
  }
  return { resolution, source, codec, hdr };
}

function resolveAlertsAndDeleteHistory(ids: number[]) {
  return prisma.$transaction([
    prisma.libraryAttentionAlert.updateMany({
      where: { status: "open", downloadHistoryId: { in: ids } },
      data: { status: "resolved_auto", resolvedAt: new Date() },
    }),
    prisma.downloadHistory.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

/** Deletes failed / post-process-errored history rows; null when the item is missing. */
export async function clearFailedDownloads(
  mediaId: number,
): Promise<number | null> {
  if (!(await mediaExists(mediaId))) return null;

  const staleRows = await prisma.downloadHistory.findMany({
    where: {
      mediaId,
      OR: [
        { failed: true },
        {
          AND: [
            { postProcessError: { not: null } },
            { postProcessError: { not: "" } },
          ],
        },
      ],
    },
    select: { id: true },
  });
  const ids = staleRows.map((r) => r.id);
  if (ids.length === 0) return 0;

  const { emitLibraryUpdate } = await import(
    "@rawkoon/api/services/libraryEvents"
  );
  await resolveAlertsAndDeleteHistory(ids);
  emitLibraryUpdate(mediaId);
  return ids.length;
}

export type RemoveHistoryResult = "ok" | "not_found" | "not_removable";

export async function removeDownloadHistoryEntry(
  mediaId: number,
  dhId: number,
): Promise<RemoveHistoryResult> {
  const { isRemovableDownloadHistoryEntry } = await import("@rawkoon/shared");

  const dh = await prisma.downloadHistory.findFirst({
    where: { id: dhId, mediaId },
    select: { id: true, failed: true, postProcessError: true },
  });
  if (!dh) return "not_found";
  if (!isRemovableDownloadHistoryEntry(dh)) return "not_removable";

  const { emitLibraryUpdate } = await import(
    "@rawkoon/api/services/libraryEvents"
  );
  await resolveAlertsAndDeleteHistory([dhId]);
  emitLibraryUpdate(mediaId);
  return "ok";
}

export type DownloadAction = "pause" | "resume" | "remove";
export type DownloadActionResult =
  | "ok"
  | "not_found"
  | "no_torrent"
  | "no_client";

export async function performDownloadAction(
  mediaId: number,
  dhId: number,
  action: DownloadAction,
  deleteFiles: boolean,
): Promise<DownloadActionResult> {
  const dh = await prisma.downloadHistory.findFirst({
    where: { id: dhId, mediaId },
    select: { id: true, mediaId: true, torrentHash: true, episodeId: true },
  });
  if (!dh) return "not_found";

  const { resolveActiveAdapter } = await import(
    "@rawkoon/api/services/downloadClient/registry"
  );
  const { emitLibraryUpdate } = await import(
    "@rawkoon/api/services/libraryEvents"
  );

  if (action === "remove") {
    if (dh.torrentHash) {
      const active = await resolveActiveAdapter();
      if (active) {
        // Best-effort: a missing torrent shouldn't block removing the row.
        await active.adapter
          .remove(dh.torrentHash, deleteFiles)
          .catch(() => {});
      }
    }
    await revertToWantedIfNoActiveGrabs({
      id: dh.id,
      mediaId: dh.mediaId,
      episodeId: dh.episodeId,
    });
    await prisma.$transaction([
      prisma.libraryAttentionAlert.updateMany({
        where: { status: "open", downloadHistoryId: dhId },
        data: { status: "resolved_auto", resolvedAt: new Date() },
      }),
      prisma.downloadHistory.delete({ where: { id: dhId } }),
    ]);
    emitLibraryUpdate(mediaId);
    return "ok";
  }

  // pause / resume — require a torrent hash
  if (!dh.torrentHash) return "no_torrent";
  const active = await resolveActiveAdapter();
  if (!active) return "no_client";
  if (action === "pause") await active.adapter.pause(dh.torrentHash);
  else await active.adapter.resume(dh.torrentHash);
  emitLibraryUpdate(mediaId);
  return "ok";
}

export type PostProcessRetryCheck =
  | "ok"
  | "not_found"
  | "failed"
  | "not_completed";

export async function checkPostProcessRetryable(
  dhId: number,
): Promise<PostProcessRetryCheck> {
  const dh = await prisma.downloadHistory.findUnique({
    where: { id: dhId },
    select: { id: true, completedAt: true, failed: true },
  });
  if (!dh) return "not_found";
  if (dh.failed) return "failed";
  if (!dh.completedAt) return "not_completed";
  return "ok";
}

/** Media files with their episode, sorted episodes-by-number then loose files by name. */
export async function listMediaFiles(id: number) {
  const media = await prisma.libraryMedia.findUnique({ where: { id } });
  if (!media) return null;

  const files = await prisma.mediaFile.findMany({
    where: { mediaId: id },
    include: {
      episode: { select: { season: true, episode: true, title: true } },
    },
  });

  files.sort((a, b) => {
    const ae = a.episode,
      be = b.episode;
    if (ae && be) {
      if (ae.season !== be.season) return ae.season - be.season;
      return ae.episode - be.episode;
    }
    if (ae) return 1;
    if (be) return -1;
    return a.fileName.localeCompare(b.fileName);
  });

  return { mediaType: media.type, files };
}

export async function updateMediaFileReleaseGroup(
  fileId: number,
  releaseGroup: string | null | undefined,
) {
  const file = await prisma.mediaFile.findUnique({ where: { id: fileId } });
  if (!file) return null;

  return prisma.mediaFile.update({
    where: { id: fileId },
    data: {
      ...(releaseGroup !== undefined ? { releaseGroup } : {}),
    },
  });
}

async function resetMediaToWantedIfNoFiles(mediaId: number) {
  const remaining = await prisma.mediaFile.count({ where: { mediaId } });
  if (remaining === 0) {
    await prisma.libraryMedia.updateMany({
      where: { id: mediaId, status: { notIn: ["wanted", "skipped"] } },
      data: { status: "wanted", searchAttempts: 0 },
    });
  }
}

/** Removes one file record (and optionally the disk file); false when it does not exist. */
export async function deleteMediaFile(
  fileId: number,
  deleteFromDisk: boolean,
): Promise<boolean> {
  const file = await prisma.mediaFile.findUnique({ where: { id: fileId } });
  if (!file) return false;

  // Delete the DB row first: a stale row pointing at a deleted file is
  // worse than a leftover file on disk. If the fs removal below fails we
  // only log it.
  await prisma.mediaFile.delete({ where: { id: fileId } });

  if (deleteFromDisk) {
    const { rm } = await import("node:fs/promises");
    try {
      await rm(file.filePath);
    } catch (e) {
      // File may already be gone, or removal failed after the row was
      // deleted — log and move on rather than resurrecting the row.
      console.warn(
        `[library/files] Failed to remove ${file.filePath} after deleting MediaFile ${fileId}:`,
        e,
      );
    }
    await pruneLibraryDirsAfterDelete([file.filePath]);
  }

  // If the parent media item now has no files left, reset it to "wanted"
  if (file.mediaId !== null) await resetMediaToWantedIfNoFiles(file.mediaId);

  return true;
}

/** Removes an episode's files, resets it to wanted; false when the episode is not found. */
export async function deleteEpisodeFiles(
  mediaId: number,
  episodeId: number,
  deleteFromDisk: boolean,
): Promise<boolean> {
  const ep = await prisma.libraryEpisode.findFirst({
    where: { id: episodeId, mediaId },
    include: { files: true },
  });
  if (!ep) return false;

  if (deleteFromDisk && ep.files.length > 0) {
    const { rm } = await import("node:fs/promises");
    for (const f of ep.files) {
      try {
        await rm(f.filePath);
      } catch {
        // ignore — file may already be gone
      }
    }
    await pruneLibraryDirsAfterDelete(ep.files.map((f) => f.filePath));
  }

  if (ep.files.length > 0) {
    await prisma.mediaFile.deleteMany({ where: { episodeId } });
  }

  await prisma.libraryEpisode.update({
    where: { id: episodeId },
    data: { status: "wanted", searchAttempts: 0, downloadedAt: null },
  });

  await resetMediaToWantedIfNoFiles(mediaId);
  return true;
}
