import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import { emitLibraryUpdate } from "@rawkoon/api/services/libraryEvents";
import { enqueueLibraryPostProcess } from "@rawkoon/api/services/postProcessorQueue";
import { notifyRequestAvailable } from "@rawkoon/api/services/mediaRequests";
import { resolveDownloadedStatus } from "@rawkoon/api/utils/medias/libraryHelpers";

/** qBittorrent states that indicate the torrent finished downloading */
export function isCompletedDownloadState(state: string): boolean {
  return (
    state === "uploading" ||
    state === "pausedUP" ||
    state === "stoppedUP" ||
    state === "stalledUP" ||
    state === "queuedUP" ||
    state === "forcedUP"
  );
}

export function isFailedState(state: string): boolean {
  return state === "error" || state === "missingFiles";
}

/** If qBittorrent reports failure and no other active grab exists, unblock stuck "downloading" rows */
export async function revertLibraryDownloadingIfNoOtherActiveGrabs(dh: {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
}): Promise<void> {
  if (dh.episodeId == null && dh.mediaId == null) return;

  const otherPending = await prisma.downloadHistory.count({
    where: {
      id: { not: dh.id },
      failed: false,
      completedAt: null,
      ...(dh.episodeId != null
        ? { episodeId: dh.episodeId }
        : { mediaId: dh.mediaId, episodeId: null }),
    },
  });
  if (otherPending > 0) return;

  if (dh.episodeId != null) {
    await prisma.libraryEpisode.updateMany({
      where: { id: dh.episodeId, status: "downloading" },
      data: { status: "wanted" },
    });
    await prisma.libraryEpisode.updateMany({
      where: { id: dh.episodeId, status: "upgrading" },
      data: { status: "downloaded" },
    });
  } else if (dh.mediaId != null) {
    await prisma.libraryMedia.updateMany({
      where: { id: dh.mediaId, status: "downloading" },
      data: { status: "wanted" },
    });
    await prisma.libraryMedia.updateMany({
      where: { id: dh.mediaId, status: "upgrading" },
      data: { status: "downloaded" },
    });
  }
}

export async function markDownloadHistoryComplete(dh: {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
}): Promise<void> {
  const completedAt = new Date();
  await prisma.downloadHistory.update({
    where: { id: dh.id },
    data: { completedAt },
  });

  if (dh.episodeId != null) {
    await prisma.libraryEpisode.update({
      where: { id: dh.episodeId },
      data: { status: "downloaded", downloadedAt: completedAt },
    });
  } else if (dh.mediaId != null) {
    const media = await prisma.libraryMedia.findUnique({
      where: { id: dh.mediaId },
      select: { type: true, tmdbStatus: true },
    });
    await prisma.libraryMedia.update({
      where: { id: dh.mediaId },
      data: {
        status: resolveDownloadedStatus(
          media?.type ?? "movie",
          media?.tmdbStatus ?? null,
        ),
      },
    });
  }

  if (dh.mediaId != null) {
    await notifyRequestAvailable(dh.mediaId);
  }
}

/**
 * Mark a single download as complete by its torrent hash.
 * Called directly by the qBittorrent webhook for immediate completion.
 *
 * Returns the download_history id whenever a non-failed DH row exists for the
 * hash. When multiple rows share a hash (common after retries/re-grabs), the
 * newest *pending* row is preferred and marked complete; if no pending row
 * exists, the newest already-completed row's id is returned so the caller
 * can re-enqueue post-processing — this is the recovery handle for cases
 * where a previous post-process run left the DB marked complete but never
 * placed the file on disk.
 */
export async function completeDownloadByHash(
  hash: string,
): Promise<number | null> {
  const normalizedHash = hash.toLowerCase().trim();
  if (!normalizedHash) return null;

  const pending = await prisma.downloadHistory.findFirst({
    where: { torrentHash: normalizedHash, completedAt: null, failed: false },
    orderBy: { id: "desc" },
  });
  if (pending) {
    await markDownloadHistoryComplete(pending);
    if (pending.mediaId != null) emitLibraryUpdate(pending.mediaId);
    return pending.id;
  }

  const completed = await prisma.downloadHistory.findFirst({
    where: { torrentHash: normalizedHash, failed: false },
    orderBy: { id: "desc" },
  });
  return completed?.id ?? null;
}

export type PendingReconcileResult = {
  completed: number;
  failed: number;
  missing: number;
};

export interface StallTrack {
  createdAtMs: number;
  lastProgress: number;
  lastProgressAtMs: number;
}

export interface ReconcileSettings {
  stallTimeoutSecs: number;
  maxAgeSecs: number;
}

export type PendingOutcome =
  | { outcome: "complete" }
  | { outcome: "fail"; reason: string }
  | { outcome: "wait"; progressed: boolean };

export function classifyPendingAgainstTorrent(
  torrent: NormalizedTorrent,
  track: StallTrack,
  nowMs: number,
  settings: ReconcileSettings,
): PendingOutcome {
  if (nowMs - track.createdAtMs > settings.maxAgeSecs * 1000) {
    return { outcome: "fail", reason: "exceeded max age with no completion" };
  }
  if (torrent.state === "completed" || torrent.progress >= 1) {
    return { outcome: "complete" };
  }
  if (torrent.state === "error") {
    return { outcome: "fail", reason: "download client reported error state" };
  }
  const progressed = torrent.progress > track.lastProgress + 1e-9;
  if (progressed) return { outcome: "wait", progressed: true };

  const timedOut =
    nowMs - track.lastProgressAtMs > settings.stallTimeoutSecs * 1000;
  if (
    timedOut &&
    (torrent.state === "stalled" || torrent.state === "downloading")
  ) {
    return {
      outcome: "fail",
      reason:
        torrent.state === "stalled"
          ? "stalled - no progress"
          : "no progress before stall timeout",
    };
  }
  return { outcome: "wait", progressed: false };
}

export function findPendingTorrent(
  torrents: NormalizedTorrent[],
  downloadHistoryId: number,
  hash: string | null,
): NormalizedTorrent | undefined {
  const normalizedHash = hash?.trim().toLowerCase();
  if (normalizedHash) {
    const byHash = torrents.find(
      (torrent) => torrent.hash.toLowerCase() === normalizedHash,
    );
    if (byHash) return byHash;
  }
  const tag = `rawkoon-dh-${downloadHistoryId}`.toLowerCase();
  return torrents.find((torrent) =>
    torrent.labels.some((label) => label.toLowerCase() === tag),
  );
}

const stallTracks = new Map<number, StallTrack>();
let lastReconcileHadProgressing = false;
let nextPollAtMs = 0;
let knownPendingIds = new Set<number>();

export function computeNextPollDelaySecs(
  hasProgressing: boolean,
  activeSecs: number,
  idleSecs: number,
): number {
  return hasProgressing ? activeSecs : idleSecs;
}

function getOrInitTrack(
  id: number,
  createdAtMs: number,
  progress: number,
  nowMs: number,
): StallTrack {
  const existing = stallTracks.get(id);
  if (existing) return existing;
  const track = {
    createdAtMs,
    lastProgress: progress,
    lastProgressAtMs: nowMs,
  };
  stallTracks.set(id, track);
  return track;
}

function clearTrack(id: number) {
  stallTracks.delete(id);
}

/**
 * Reconcile a set of pending (non-completed, non-failed) download_history rows
 * against qBittorrent state. If `treatMissingAsFailed` is true, rows whose
 * torrent is absent from qBittorrent are marked failed and the library status
 * reverted — used by the rescan action so the UI isn't stuck on "downloading"
 * when the user deleted the torrent out-of-band.
 */
export async function reconcilePendingDownloads(
  pending: Array<{
    id: number;
    mediaId: number | null;
    episodeId: number | null;
    torrentHash: string | null;
    createdAt?: Date | null;
  }>,
  opts: {
    treatMissingAsFailed?: boolean;
    settings?: ReconcileSettings;
  } = {},
): Promise<PendingReconcileResult> {
  const result: PendingReconcileResult = {
    completed: 0,
    failed: 0,
    missing: 0,
  };
  lastReconcileHadProgressing = false;
  if (!pending.length) return result;

  const active = await resolveActiveAdapter();
  if (!active) return result;

  let torrents: NormalizedTorrent[];
  try {
    torrents = await active.adapter.listTorrents();
  } catch (error) {
    console.warn(
      "[reconcilePendingDownloads] listTorrents failed:",
      error,
    );
    return result;
  }

  const settings = opts.settings ?? {
    stallTimeoutSecs: 2700,
    maxAgeSecs: 604800,
  };
  const nowMs = Date.now();

  for (let dh of pending) {
    try {
      const match = findPendingTorrent(torrents, dh.id, dh.torrentHash);
      if (!match) {
        if (opts.treatMissingAsFailed) {
          await prisma.downloadHistory.update({
            where: { id: dh.id },
            data: {
              failed: true,
              failReason: "torrent missing from download client",
            },
          });
          await revertLibraryDownloadingIfNoOtherActiveGrabs(dh);
          if (dh.mediaId != null) emitLibraryUpdate(dh.mediaId);
          clearTrack(dh.id);
          result.missing += 1;
        }
        continue;
      }

      if (!dh.torrentHash) {
        const torrentHash = match.hash.toLowerCase();
        await prisma.downloadHistory.update({
          where: { id: dh.id },
          data: { torrentHash },
        });
        dh = { ...dh, torrentHash };
      }

      const track = getOrInitTrack(
        dh.id,
        dh.createdAt?.getTime() ?? nowMs,
        match.progress,
        nowMs,
      );
      const verdict = classifyPendingAgainstTorrent(
        match,
        track,
        nowMs,
        settings,
      );

      if (verdict.outcome === "wait") {
        if (
          match.state === "downloading" &&
          (verdict.progressed || match.dlSpeed > 0)
        ) {
          lastReconcileHadProgressing = true;
        }
        if (verdict.progressed) {
          track.lastProgress = match.progress;
          track.lastProgressAtMs = nowMs;
        }
        continue;
      }

      if (verdict.outcome === "fail") {
        await prisma.downloadHistory.update({
          where: { id: dh.id },
          data: {
            failed: true,
            failReason: verdict.reason,
          },
        });
        await revertLibraryDownloadingIfNoOtherActiveGrabs(dh);
        if (dh.mediaId != null) emitLibraryUpdate(dh.mediaId);
        clearTrack(dh.id);
        result.failed += 1;
        continue;
      }

      let completedId = dh.torrentHash
        ? await completeDownloadByHash(dh.torrentHash)
        : null;
      if (completedId == null) {
        await markDownloadHistoryComplete(dh);
        completedId = dh.id;
      }
      if (completedId != null) {
        enqueueLibraryPostProcess(completedId);
        clearTrack(dh.id);
        result.completed += 1;
      }
    } catch (e) {
      console.warn(
        `[reconcilePendingDownloads] Failed for download_history ${dh.id}:`,
        e,
      );
    }
  }

  return result;
}

/**
 * Safety-net fallback: polls qBittorrent for all pending downloads.
 * Runs every 30 minutes to catch completions that the webhook may have missed
 * (e.g. Rawkoon was down when the torrent finished, or hash was not yet known).
 */
export async function checkDownloadCompletion(): Promise<void> {
  const pending = await prisma.downloadHistory.findMany({
    where: { completedAt: null, failed: false },
    select: {
      id: true,
      mediaId: true,
      episodeId: true,
      torrentHash: true,
      createdAt: true,
    },
  });
  const settings = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  const nowMs = Date.now();
  const currentIds = new Set(pending.map((download) => download.id));
  const hasNewPending = pending.some(
    (download) => !knownPendingIds.has(download.id),
  );
  knownPendingIds = currentIds;

  if (!pending.length) {
    nextPollAtMs =
      nowMs + (settings?.downloadPollIdleSecs ?? 1800) * 1000;
    return;
  }
  if (!hasNewPending && nowMs < nextPollAtMs) return;

  await reconcilePendingDownloads(pending, {
    settings: {
      stallTimeoutSecs: settings?.downloadStallTimeoutSecs ?? 2700,
      maxAgeSecs: settings?.downloadMaxAgeSecs ?? 604800,
    },
  });
  nextPollAtMs =
    nowMs +
    computeNextPollDelaySecs(
      lastReconcileHadProgressing,
      settings?.downloadPollActiveSecs ?? 20,
      settings?.downloadPollIdleSecs ?? 1800,
    ) *
      1000;
}
