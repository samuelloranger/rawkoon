import { prisma } from "@rawkoon/api/db";
import {
  type OutcomeEffects,
  productionOutcomeEffects,
} from "@rawkoon/api/services/downloads/outcomeEffects";

/**
 * The only place a DownloadHistory row reaches a terminal state, and the only writer of the
 * post-process outcome fields. Two mid-import checkpoints stay with their post-processors
 * (see postProcessorSeasonPack and postProcessorBookDownload). Grab-time failures stay in the grab path.
 */

/** The minimum a caller must know about a row to finish it. */
export type DownloadRef = {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
  /** Set instead of mediaId/episodeId when the grab was for a book edition. */
  bookEditionId?: number | null;
};

/** Unblock an item with no other active grab: `downloading` -> `wanted`, in-flight upgrade -> `downloaded`. */
export async function revertToWantedIfNoActiveGrabs(
  dh: DownloadRef,
  effects: OutcomeEffects = productionOutcomeEffects,
): Promise<void> {
  // Books first: a book row has no mediaId, so a failed book download would stay "downloading".
  if (dh.bookEditionId != null) {
    const otherBookPending = await prisma.downloadHistory.count({
      where: {
        id: { not: dh.id },
        failed: false,
        completedAt: null,
        bookEditionId: dh.bookEditionId,
      },
    });
    if (otherBookPending > 0) return;

    await prisma.bookEdition.updateMany({
      where: { id: dh.bookEditionId, status: "downloading" },
      data: { status: "wanted" },
    });
    await prisma.bookEdition.updateMany({
      where: { id: dh.bookEditionId, status: "upgrading" },
      data: { status: "downloaded" },
    });

    const reverted = await prisma.bookEdition.findUnique({
      where: { id: dh.bookEditionId },
      select: { bookId: true },
    });
    if (reverted) effects.bookChanged(reverted.bookId);
    return;
  }

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

/** DB half of a completion. */
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
    await prisma.libraryMedia.update({
      where: { id: dh.mediaId },
      data: { status: "downloaded", searchAttempts: 0 },
    });
  }
}

/** Finish a download: transition, notify listeners and requester, schedule post-processing. */
export async function completeDownload(
  dh: DownloadRef,
  effects: OutcomeEffects = productionOutcomeEffects,
): Promise<number> {
  await applyCompletionTransition(dh);

  if (dh.mediaId != null) {
    effects.libraryChanged(dh.mediaId);
    // Reads the status written above, so it must run after the transition; a failure must not stop post-processing being queued.
    await effects
      .requestAvailable(dh.mediaId)
      .catch((e) =>
        console.warn(
          `[downloadOutcome] request availability check failed media=${dh.mediaId}:`,
          e,
        ),
      );
  }

  // Scheduling failure must not undo the transition (reconcile skips completed rows), so persist the reason.
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

/** Complete the newest pending row for a hash, else re-queue the newest completed one (recovery for a file that never landed). */
export async function completeDownloadByHash(
  hash: string,
  effects: OutcomeEffects = productionOutcomeEffects,
): Promise<number | null> {
  const normalizedHash = hash.toLowerCase().trim();
  if (!normalizedHash) return null;

  const pending = await prisma.downloadHistory.findFirst({
    where: { torrentHash: normalizedHash, completedAt: null, failed: false },
    orderBy: { id: "desc" },
  });
  if (pending) return completeDownload(pending, effects);

  const completed = await prisma.downloadHistory.findFirst({
    where: { torrentHash: normalizedHash, failed: false },
    orderBy: { id: "desc" },
  });
  if (!completed) return null;
  // A kept row whose library item was removed only seeds; there is nothing to import.
  if (completed.mediaId == null && completed.bookEditionId == null) return null;

  // force: a retained completed job with the same id would make the add a no-op.
  await enqueuePostProcess(completed.id, { force: true });
  return completed.id;
}

/** Mark a download failed and unblock the item if nothing else is in flight. */
export async function failDownload(
  dh: DownloadRef,
  reason: string,
  effects: OutcomeEffects = productionOutcomeEffects,
): Promise<void> {
  await prisma.downloadHistory.update({
    where: { id: dh.id },
    data: { failed: true, failReason: reason },
  });
  await revertToWantedIfNoActiveGrabs(dh, effects);
  if (dh.mediaId != null) {
    effects.libraryChanged(dh.mediaId);
    try {
      await effects.downloadFailed({
        mediaId: dh.mediaId,
        downloadHistoryId: dh.id,
        episodeId: dh.episodeId,
        reason,
      });
    } catch (e) {
      console.warn("[downloadOutcome] download-failed notification failed:", e);
    }
  }
}

/** Attach an existing client torrent to a row; one already complete gets a full completion. */
export async function adoptDownload(ctx: {
  dh: DownloadRef;
  torrentHash: string;
  completed: boolean;
  isUpgrade?: boolean;
  effects?: OutcomeEffects;
}): Promise<void> {
  const { dh, torrentHash, completed, isUpgrade } = ctx;
  const effects = ctx.effects ?? productionOutcomeEffects;

  await prisma.downloadHistory.update({
    where: { id: dh.id },
    data: {
      torrentHash,
      failed: false,
      failReason: null,
      // The user added this torrent; Rawkoon imports it but never removes it.
      seedReleasedAt: new Date(),
      seedReleaseReason: "adopted",
    },
  });

  if (completed) {
    await completeDownload(dh, effects);
    return;
  }

  const nextStatus = isUpgrade ? "upgrading" : "downloading";
  if (dh.bookEditionId != null) {
    const edition = await prisma.bookEdition.update({
      where: { id: dh.bookEditionId },
      data: { status: nextStatus, searchAttempts: 0 },
      select: { bookId: true },
    });
    effects.bookChanged(edition.bookId);
  } else if (dh.episodeId != null) {
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

/** Hyphens, not colons: BullMQ rejects custom job ids containing `:`. */
export function postProcessJobId(
  downloadHistoryId: number,
  opts: { force?: boolean; nowMs?: number } = {},
): string {
  const base = `post-process-${downloadHistoryId}`;
  return opts.force ? `${base}-${opts.nowMs ?? Date.now()}` : base;
}

/** Schedule post-processing; `force` bypasses the dedupe id, which a retained completed job would turn into a silent no-op. */
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

  // Lazy: queueService opens redis at import time, which DB-only consumers and tests must not trigger.
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

export { finishPostProcess } from "@rawkoon/api/services/downloads/downloadOutcomePostProcess";
