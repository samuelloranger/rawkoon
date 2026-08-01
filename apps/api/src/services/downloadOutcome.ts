import { prisma } from "@rawkoon/api/db";
import { emitLibraryUpdate } from "@rawkoon/api/services/libraryEvents";
import { triggerJellyfinLibraryScan } from "@rawkoon/api/services/jellyfinLibraryRefresh";
import { notifyRequestAvailable } from "@rawkoon/api/services/mediaRequests";
import { postProcess } from "@rawkoon/api/services/postProcessorSingle";
import { resolveDownloadedStatus } from "@rawkoon/api/utils/medias/libraryHelpers";
import { notifyAdminsMediaDownloaded } from "@rawkoon/api/workers/notifyMediaDownloaded";
import { notifyAdminsPostProcessFailed } from "@rawkoon/api/workers/notifyPostProcessFailed";

/**
 * Download outcome — the terminal transition of a DownloadHistory row.
 *
 * Every path that finishes a download goes through this module: the reconcile
 * loop, duplicate adoption, rescan, and the admin retry-post-process endpoint.
 * Nothing else writes a terminal DownloadHistory state.
 *
 * A terminal transition is never just the DownloadHistory row — it carries the
 * library status change on the parent media/episode, the request notification,
 * and the post-process job it schedules. Keeping those together is the point of
 * this module: they used to be spread across the completion worker, a
 * fire-and-forget "queue" that had no queue, and three call sites that each
 * did a subset.
 *
 * Grab-time failure (a release that was never handed to the download client) is
 * NOT a download outcome and stays in the grab path.
 */

/** The minimum a caller must know about a row to finish it. */
export type DownloadRef = {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
};

/**
 * If no other active grab exists for the item, unblock it: `downloading` falls
 * back to `wanted`, and an in-flight upgrade falls back to `downloaded` (the
 * file it was upgrading is still there).
 *
 * Two triggers, one rule: a download failed, or an operator deleted a file.
 */
export async function revertToWantedIfNoActiveGrabs(
  dh: DownloadRef,
): Promise<void> {
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

/**
 * The DB half of a completion: stamp the row, move the item to its downloaded
 * state, and clear search attempts.
 *
 * `resolveDownloadedStatus` matters for shows — an airing series is not
 * "downloaded" just because one grab finished.
 */
async function applyCompletionTransition(dh: DownloadRef): Promise<void> {
  const completedAt = new Date();
  await prisma.downloadHistory.update({
    where: { id: dh.id },
    data: { completedAt },
  });

  if (dh.episodeId != null) {
    await prisma.libraryEpisode.update({
      where: { id: dh.episodeId },
      data: {
        status: "downloaded",
        downloadedAt: completedAt,
        searchAttempts: 0,
      },
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
        searchAttempts: 0,
      },
    });
  }
}

/**
 * Finish a download: apply the transition, tell listeners, notify any waiting
 * requester, and schedule post-processing.
 *
 * Returns the DownloadHistory id that was completed.
 */
export async function completeDownload(dh: DownloadRef): Promise<number> {
  await applyCompletionTransition(dh);

  if (dh.mediaId != null) {
    emitLibraryUpdate(dh.mediaId);
    // Reads the status written above, so it must run after the transition.
    await notifyRequestAvailable(dh.mediaId);
  }

  // Scheduling must not undo the transition. The row is already stamped
  // complete, and the reconcile loop only revisits rows with completedAt: null
  // — so letting a queue outage throw here would strand the file with nothing
  // recording why. Persist the reason instead: the UI surfaces it and rescan
  // can re-queue.
  try {
    await enqueuePostProcess(dh.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[downloadOutcome] failed to queue post-process dh=${dh.id}:`,
      e,
    );
    await prisma.downloadHistory
      .update({
        where: { id: dh.id },
        data: { postProcessError: `could not queue post-processing: ${msg}` },
      })
      .catch(() => {});
  }
  return dh.id;
}

/**
 * Complete the download owned by a torrent hash.
 *
 * When several rows share a hash (common after retries and re-grabs) the newest
 * *pending* row wins. If none is pending, the newest already-completed row is
 * re-queued for post-processing instead — the recovery handle for a download
 * marked complete in the DB whose file never reached the library.
 *
 * Returns the DownloadHistory id handled, or null when the hash is unknown.
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
  if (pending) return completeDownload(pending);

  const completed = await prisma.downloadHistory.findFirst({
    where: { torrentHash: normalizedHash, failed: false },
    orderBy: { id: "desc" },
  });
  if (!completed) return null;

  // force: this is the recovery path for a row whose file never landed. A
  // completed job for the same row may still be retained by the queue, and
  // BullMQ ignores an add whose id already exists.
  await enqueuePostProcess(completed.id, { force: true });
  return completed.id;
}

/** Mark a download failed and unblock the item if nothing else is in flight. */
export async function failDownload(
  dh: DownloadRef,
  reason: string,
): Promise<void> {
  await prisma.downloadHistory.update({
    where: { id: dh.id },
    data: { failed: true, failReason: reason },
  });
  await revertToWantedIfNoActiveGrabs(dh);
  if (dh.mediaId != null) emitLibraryUpdate(dh.mediaId);
}

/**
 * Attach an existing client torrent to a DownloadHistory row instead of adding
 * the torrent again.
 *
 * An adopted torrent that is already complete produces a full completion — the
 * same one a fresh grab would, including the request notification.
 */
export async function adoptDownload(ctx: {
  dh: DownloadRef;
  torrentHash: string;
  completed: boolean;
  isUpgrade?: boolean;
}): Promise<void> {
  const { dh, torrentHash, completed, isUpgrade } = ctx;

  await prisma.downloadHistory.update({
    where: { id: dh.id },
    data: { torrentHash, failed: false, failReason: null },
  });

  if (completed) {
    await completeDownload(dh);
    return;
  }

  const nextStatus = isUpgrade ? "upgrading" : "downloading";
  if (dh.episodeId != null) {
    await prisma.libraryEpisode.update({
      where: { id: dh.episodeId },
      data: { status: nextStatus, searchAttempts: 0 },
    });
  } else if (dh.mediaId != null) {
    await prisma.libraryMedia.update({
      where: { id: dh.mediaId },
      data: { status: nextStatus, searchAttempts: 0 },
    });
  }
}

/**
 * Build the job id for a post-process run.
 *
 * Hyphens, not colons: BullMQ reserves `:` as its key separator and rejects a
 * custom id containing one (the only exception is a three-segment id, kept for
 * repeatable-job compatibility — not something to rely on).
 */
export function postProcessJobId(
  downloadHistoryId: number,
  opts: { force?: boolean; nowMs?: number } = {},
): string {
  const base = `post-process-${downloadHistoryId}`;
  return opts.force ? `${base}-${opts.nowMs ?? Date.now()}` : base;
}

/**
 * Schedule post-processing for a completed download.
 *
 * The job id keeps a row from being queued twice while a run is pending.
 * `force` bypasses that, and every *recovery* enqueue uses it — rescan, the
 * already-complete branch of `completeDownloadByHash`, and the admin retry —
 * because a retained completed job would otherwise make the add a silent no-op
 * that still reports success.
 *
 * Returns false when post-processing is disabled, in which case nothing is
 * queued at all.
 */
export async function enqueuePostProcess(
  downloadHistoryId: number,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: { postProcessingEnabled: true },
  });
  if (!settings?.postProcessingEnabled) return false;

  const jobId = postProcessJobId(downloadHistoryId, opts);

  // Loaded lazily: queueService constructs BullMQ queues and opens a redis
  // client at import time, so pulling it into this module's import graph would
  // stand up redis for every consumer of a download outcome — including tests
  // that only exercise the DB transition.
  const { addJob, POST_PROCESS_JOB_NAME, QUEUE_NAMES } = await import(
    "@rawkoon/api/services/queueService"
  );

  await addJob(
    QUEUE_NAMES.LIBRARY_POST_PROCESS,
    POST_PROCESS_JOB_NAME,
    { downloadHistoryId },
    { jobId },
  );
  return true;
}

export type PostProcessOutcome =
  | { success: true; destinationPath: string }
  | { success: false; reason: string };

/**
 * The post-process job body: place the download into the library, then record
 * what happened.
 *
 * Never throws for a business failure — the reason is persisted on the row and
 * reported to admins, because a failed placement is a state the UI must show,
 * not a lost job.
 */
export async function finishPostProcess(
  downloadHistoryId: number,
): Promise<PostProcessOutcome> {
  let mediaId: number | null | undefined;
  try {
    const dh = await prisma.downloadHistory.findUnique({
      where: { id: downloadHistoryId },
      select: { mediaId: true },
    });
    mediaId = dh?.mediaId;

    const result = await postProcess(downloadHistoryId);

    if (!result.success) {
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: { postProcessError: result.reason },
      });
      if (mediaId != null) emitLibraryUpdate(mediaId);
      await notifyAdminsPostProcessFailed(
        downloadHistoryId,
        result.reason,
        mediaId,
      );
      return result;
    }

    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        postProcessDestinationPath: result.destinationPath,
        postProcessError: null,
      },
    });
    if (mediaId != null) {
      emitLibraryUpdate(mediaId);
      await notifyAdminsMediaDownloaded(mediaId);
    }
    await triggerJellyfinLibraryScan();
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[downloadOutcome] post-process failed dh=${downloadHistoryId}:`,
      e,
    );
    try {
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: { postProcessError: msg },
      });
      await notifyAdminsPostProcessFailed(downloadHistoryId, msg, mediaId);
    } catch (persistError) {
      console.warn(
        `[downloadOutcome] failed to persist postProcessError dh=${downloadHistoryId}:`,
        persistError,
      );
    }
    return { success: false, reason: msg };
  }
}
