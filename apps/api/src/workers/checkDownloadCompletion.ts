import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  completeDownload,
  completeDownloadByHash,
  failDownload,
} from "@rawkoon/api/services/downloads/downloadOutcome";
import { rejectRelease } from "@rawkoon/api/services/downloads/downloadJanitor";
import {
  classifyPendingAgainstTorrent,
  computeNextPollDelaySecs,
  createReconcileState,
  findPendingTorrent,
  getOrInitTrack,
  HOOK_RECENT_WINDOW_MS,
  isMassStall,
  rejectable,
  selectActiveCadenceSecs,
  type PendingOutcome,
  type ReconcileSettings,
  type ReconcileState,
  type StallTrack,
} from "@rawkoon/api/workers/downloadReconcilePolicy";
import { findBlockedFile } from "@rawkoon/api/services/seeding/seedPolicy";

/** One pass over pending DownloadHistory rows; owns polling cadence and stall/max-age policy, while transitions live in downloadOutcome. */

export {
  classifyPendingAgainstTorrent,
  computeNextPollDelaySecs,
  createReconcileState,
  findPendingTorrent,
  HOOK_RECENT_WINDOW_MS,
  selectActiveCadenceSecs,
  type PendingOutcome,
  type ReconcileSettings,
  type ReconcileState,
  type StallTrack,
};

/** The subset of the download outcome module this loop drives. */
export type DownloadOutcomeHandlers = {
  completeDownload: typeof completeDownload;
  completeDownloadByHash: typeof completeDownloadByHash;
  failDownload: typeof failDownload;
  rejectRelease: typeof rejectRelease;
};

const defaultOutcome: DownloadOutcomeHandlers = {
  completeDownload,
  completeDownloadByHash,
  failDownload,
  rejectRelease,
};

export type PendingReconcileResult = {
  completed: number;
  failed: number;
  missing: number;
};

/** Production state for the scheduled job. */
const pollState = createReconcileState();

/** Clear the poll gate; call it BEFORE enqueuing the check job, which returns early while the gate is closed. */
export function requestImmediatePoll(): void {
  pollState.nextPollAtMs = 0;
}

/** Reconcile pending rows against client state; `treatMissingAsFailed` (rescan) fails rows whose torrent was deleted out-of-band. */
export async function reconcilePendingDownloads(
  pending: Array<{
    id: number;
    mediaId: number | null;
    episodeId: number | null;
    torrentHash: string | null;
    grabbedAt?: Date | null;
    releaseTitle?: string;
    indexer?: string | null;
    bookEditionId?: number | null;
    isUpgrade?: boolean;
  }>,
  opts: {
    treatMissingAsFailed?: boolean;
    settings?: ReconcileSettings;
    state?: ReconcileState;
    /** Torrent source; injectable so tests need no module mocking. */
    listTorrents?: () => Promise<NormalizedTorrent[]>;
    /** Outcome transitions; injectable so tests can assert decisions without the DB. */
    outcome?: DownloadOutcomeHandlers;
    /** File listing for the blocked-extension check; defaults to the active client. */
    listFiles?: (hash: string) => Promise<string[] | null>;
    blockedExtensions?: string[];
  } = {},
): Promise<PendingReconcileResult> {
  const state = opts.state ?? pollState;
  const outcome = opts.outcome ?? defaultOutcome;
  const result: PendingReconcileResult = {
    completed: 0,
    failed: 0,
    missing: 0,
  };
  state.lastReconcileHadActive = false;
  if (!pending.length) return result;

  let listTorrents = opts.listTorrents;
  let listFiles = opts.listFiles;
  if (!listTorrents) {
    const active = await resolveActiveAdapter();
    if (!active) return result;
    listTorrents = () => active.adapter.listTorrents();
    listFiles ??= (hash) => active.adapter.listFiles(hash);
  }
  const blocked = opts.blockedExtensions ?? [];

  let torrents: NormalizedTorrent[];
  try {
    torrents = await listTorrents();
  } catch (error) {
    console.warn("[reconcilePendingDownloads] listTorrents failed:", error);
    // Pending is non-empty here, so this is a client blip; keep lastReconcileHadActive true to avoid the idle backoff.
    state.lastReconcileHadActive = true;
    return result;
  }

  const settings = opts.settings ?? {
    stallTimeoutSecs: 2700,
    maxAgeSecs: 604800,
  };
  const nowMs = Date.now();
  const massStall = isMassStall(pending, torrents, state, nowMs, settings);

  for (let dh of pending) {
    try {
      const match = findPendingTorrent(torrents, dh.id, dh.torrentHash);
      if (!match) {
        if (opts.treatMissingAsFailed) {
          await outcome.failDownload(
            dh,
            "torrent missing from download client",
          );
          result.missing += 1;
        }
        // Stop tracking, or the map grows for every torrent removed out-of-band.
        state.stallTracks.delete(dh.id);
        state.filesChecked.delete(dh.id);
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

      if (blocked.length > 0 && listFiles && !state.filesChecked.has(dh.id)) {
        const files = await listFiles(match.hash).catch(() => null);
        if (files) {
          const bad = findBlockedFile(files, blocked);
          if (bad) {
            await outcome.rejectRelease(
              rejectable(dh),
              "malware",
              `blocked file type: ${bad}`,
            );
            state.stallTracks.delete(dh.id);
            result.failed += 1;
            continue;
          }
          state.filesChecked.add(dh.id);
        }
      }

      const track = getOrInitTrack(
        state,
        dh.id,
        dh.grabbedAt?.getTime() ?? nowMs,
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
        // Anything still intended to finish keeps the fast cadence; a paused torrent won't move until the user acts.
        if (match.state !== "paused") state.lastReconcileHadActive = true;
        if (verdict.progressed) {
          track.lastProgress = match.progress;
          track.lastProgressAtMs = nowMs;
        }
        continue;
      }

      if (verdict.outcome === "fail") {
        // Everything stalling together is a network outage, not a bad release.
        if (verdict.failKind === "stalled" && !massStall) {
          await outcome.rejectRelease(
            rejectable(dh),
            "stalled",
            verdict.reason,
          );
        } else {
          await outcome.failDownload(dh, verdict.reason);
        }
        state.stallTracks.delete(dh.id);
        state.filesChecked.delete(dh.id);
        result.failed += 1;
        continue;
      }

      // Prefer the hash: rows can share it after a re-grab, and it covers a completed row whose file never reached the library.
      const completedId = dh.torrentHash
        ? await outcome.completeDownloadByHash(dh.torrentHash)
        : null;
      if (completedId == null) await outcome.completeDownload(dh);
      state.stallTracks.delete(dh.id);
      state.filesChecked.delete(dh.id);
      result.completed += 1;
    } catch (e) {
      console.warn(
        `[reconcilePendingDownloads] Failed for download_history ${dh.id}:`,
        e,
      );
    }
  }

  return result;
}

/** In-flight reconcile: overlapping triggers must coalesce, or two passes import the same download twice via the forced recovery branch. */
let reconcileInFlight: Promise<void> | null = null;

/** Run `pass` or join the running one; awaiting keeps each job active until the work finishes. Exported for tests. */
export async function runCoalescedPass(
  pass: () => Promise<void>,
): Promise<void> {
  if (reconcileInFlight) return await reconcileInFlight;
  reconcileInFlight = pass().finally(() => {
    reconcileInFlight = null;
  });
  return await reconcileInFlight;
}

export async function checkDownloadCompletion(): Promise<void> {
  return await runCoalescedPass(runDownloadCompletionPass);
}

/** Warn-only threshold: a `take` would let orphaned pending rows starve newer downloads; the partial index keeps the query cheap. */
const PENDING_RECONCILE_WARN_AT = 500;

async function runDownloadCompletionPass(): Promise<void> {
  const [pending, settings] = await Promise.all([
    prisma.downloadHistory.findMany({
      // Served by partial index ix_download_history_active_grabbed_at (filter and sort).
      where: { completedAt: null, failed: false },
      select: {
        id: true,
        mediaId: true,
        episodeId: true,
        // Without bookEditionId a failed book grab never reverted its edition.
        bookEditionId: true,
        isUpgrade: true,
        torrentHash: true,
        grabbedAt: true,
        releaseTitle: true,
        indexer: true,
      },
      orderBy: { grabbedAt: "asc" },
    }),
    prisma.mediaSettings.findUnique({ where: { id: 1 } }),
  ]);
  if (pending.length >= PENDING_RECONCILE_WARN_AT) {
    console.warn(
      `[checkDownloadCompletion] ${pending.length} pending downloads in one pass — expected a handful. Rows whose torrent no longer exists in the client stay pending indefinitely; check for orphans.`,
    );
  }
  const nowMs = Date.now();
  const currentIds = new Set(pending.map((download) => download.id));
  const hasNewPending = pending.some(
    (download) => !pollState.knownPendingIds.has(download.id),
  );
  pollState.knownPendingIds = currentIds;

  if (!pending.length) {
    pollState.nextPollAtMs =
      nowMs + (settings?.downloadPollIdleSecs ?? 1800) * 1000;
    return;
  }
  if (!hasNewPending && nowMs < pollState.nextPollAtMs) return;

  await reconcilePendingDownloads(pending, {
    state: pollState,
    settings: {
      stallTimeoutSecs: settings?.downloadStallTimeoutSecs ?? 2700,
      maxAgeSecs: settings?.downloadMaxAgeSecs ?? 604800,
    },
    blockedExtensions: settings?.blockedExtensions ?? [],
  });
  const activeSecs = selectActiveCadenceSecs({
    hookLastSeenAt: settings?.downloadHookLastSeenAt ?? null,
    nowMs,
    activeSecs: settings?.downloadPollActiveSecs ?? 20,
    hookedActiveSecs: settings?.downloadPollActiveHookedSecs ?? 120,
  });
  const delaySecs = computeNextPollDelaySecs(
    pollState.lastReconcileHadActive,
    activeSecs,
    settings?.downloadPollIdleSecs ?? 1800,
    pollState.idlePasses,
  );
  pollState.idlePasses = pollState.lastReconcileHadActive
    ? 0
    : pollState.idlePasses + 1;
  pollState.nextPollAtMs = nowMs + delaySecs * 1000;
}
