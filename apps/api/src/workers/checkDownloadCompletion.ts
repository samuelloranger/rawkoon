import { prisma } from "@rawkoon/api/db";
import { getQbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/config";
import { emitLibraryUpdate } from "@rawkoon/api/services/libraryEvents";
import { fetchMaindata } from "@rawkoon/api/services/qbittorrent/clientFetch";
import { resetMaindataState } from "@rawkoon/api/services/qbittorrent/clientSession";
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
  }>,
  opts: { treatMissingAsFailed?: boolean } = {},
): Promise<PendingReconcileResult> {
  const result: PendingReconcileResult = {
    completed: 0,
    failed: 0,
    missing: 0,
  };
  if (!pending.length) return result;

  const qb = await getQbittorrentIntegrationConfig();
  if (!qb.enabled || !qb.config) return result;

  resetMaindataState();
  let torrents: Map<string, Record<string, unknown>>;
  try {
    ({ torrents } = await fetchMaindata(qb.config));
  } catch (e) {
    console.warn("[reconcilePendingDownloads] fetchMaindata failed:", e);
    return result;
  }

  const byHash = new Map<string, Record<string, unknown>>();
  for (const [h, raw] of torrents) byHash.set(h.toLowerCase(), raw);

  for (let dh of pending) {
    try {
      let raw: Record<string, unknown> | undefined;
      const tag = `rawkoon-dh-${dh.id}`.toLowerCase();

      if (dh.torrentHash) raw = byHash.get(dh.torrentHash.toLowerCase());
      if (!raw) {
        for (const [h, torrentRow] of torrents) {
          const tStr =
            typeof torrentRow.tags === "string" ? torrentRow.tags : "";
          const tags = tStr
            .split(",")
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean);
          if (tags.includes(tag)) {
            raw = torrentRow;
            if (!dh.torrentHash) {
              const nh = h.toLowerCase();
              await prisma.downloadHistory.update({
                where: { id: dh.id },
                data: { torrentHash: nh },
              });
              dh = { ...dh, torrentHash: nh };
            }
            break;
          }
        }
      }

      if (!raw) {
        if (opts.treatMissingAsFailed) {
          await prisma.downloadHistory.update({
            where: { id: dh.id },
            data: {
              failed: true,
              failReason: "torrent missing from qBittorrent",
            },
          });
          await revertLibraryDownloadingIfNoOtherActiveGrabs(dh);
          if (dh.mediaId != null) emitLibraryUpdate(dh.mediaId);
          result.missing += 1;
        }
        continue;
      }

      const state = typeof raw.state === "string" ? raw.state : "";
      const progress =
        typeof raw.progress === "number" && Number.isFinite(raw.progress)
          ? raw.progress
          : 0;

      if (isFailedState(state)) {
        await prisma.downloadHistory.update({
          where: { id: dh.id },
          data: {
            failed: true,
            failReason: `qBittorrent state: ${state || "unknown"}`,
          },
        });
        await revertLibraryDownloadingIfNoOtherActiveGrabs(dh);
        if (dh.mediaId != null) emitLibraryUpdate(dh.mediaId);
        result.failed += 1;
        continue;
      }

      if (isCompletedDownloadState(state) || progress >= 1) {
        let completedId: number | null = null;
        if (dh.torrentHash) {
          completedId = await completeDownloadByHash(dh.torrentHash);
        }
        if (completedId == null && !dh.torrentHash) {
          await markDownloadHistoryComplete(dh);
          completedId = dh.id;
        }
        if (completedId != null) {
          enqueueLibraryPostProcess(completedId);
          result.completed += 1;
        }
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
  });
  if (!pending.length) return;
  await reconcilePendingDownloads(pending);
}
