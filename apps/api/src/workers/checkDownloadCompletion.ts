import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  completeDownload,
  completeDownloadByHash,
  failDownload,
} from "@rawkoon/api/services/downloadOutcome";

/**
 * Reconcile — one pass comparing pending DownloadHistory rows against the
 * download client, deciding per row whether it completed, failed, stalled, or
 * should keep waiting.
 *
 * This module owns polling cadence and stall/max-age policy only. The
 * transitions themselves belong to services/downloadOutcome.ts.
 */

/** The subset of the download outcome module this loop drives. */
export type DownloadOutcomeHandlers = {
  completeDownload: typeof completeDownload;
  completeDownloadByHash: typeof completeDownloadByHash;
  failDownload: typeof failDownload;
};

const defaultOutcome: DownloadOutcomeHandlers = {
  completeDownload,
  completeDownloadByHash,
  failDownload,
};

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

/**
 * Poll state carried between reconcile passes.
 *
 * Explicit rather than module-global so a test can drive the loop with a fresh
 * state instead of inheriting whatever the previous test left behind.
 */
export type ReconcileState = {
  /** Per-row progress tracking, used to detect stalls. */
  stallTracks: Map<number, StallTrack>;
  /**
   * Whether the last pass saw a row still live in the client — downloading,
   * or stalled but expected to resume. Drives poll cadence.
   *
   * Deliberately not "made progress this pass": a fresh magnet sits at
   * `stalled` with no peers for the first few passes, and a torrent that
   * finishes during a long backoff stays unrecorded until the next tick.
   */
  lastReconcileHadActive: boolean;
  /** Consecutive passes with nothing live — indexes the backoff ramp. */
  idlePasses: number;
  /** Earliest time the next poll is allowed to do work. */
  nextPollAtMs: number;
  /** Rows seen last pass, so a newly-grabbed row can pre-empt the backoff. */
  knownPendingIds: Set<number>;
};

export function createReconcileState(): ReconcileState {
  return {
    stallTracks: new Map(),
    lastReconcileHadActive: false,
    idlePasses: 0,
    nextPollAtMs: 0,
    knownPendingIds: new Set(),
  };
}

/** Production state for the scheduled job. */
const pollState = createReconcileState();

/** How long a received hook keeps the slow cadence in effect. */
export const HOOK_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Clear the poll gate so the next `checkDownloadCompletion()` runs immediately.
 *
 * Callers MUST invoke this *before* enqueuing the check job: the job returns
 * early while the gate is closed, so enqueuing first makes the wake a no-op.
 */
export function requestImmediatePoll(): void {
  pollState.nextPollAtMs = 0;
}

/**
 * Pick the active poll interval.
 *
 * A hook that has gone quiet — never configured, broken, or pointing at a stale
 * token — yields the unhooked interval, so a silently broken hook can never make
 * detection slower than it was before hooks existed.
 */
export function selectActiveCadenceSecs(input: {
  hookLastSeenAt: Date | null;
  nowMs: number;
  activeSecs: number;
  hookedActiveSecs: number;
}): number {
  const { hookLastSeenAt, nowMs, activeSecs, hookedActiveSecs } = input;
  if (!hookLastSeenAt) return activeSecs;
  const age = nowMs - hookLastSeenAt.getTime();
  if (age < 0 || age >= HOOK_RECENT_WINDOW_MS) return activeSecs;
  return hookedActiveSecs;
}

/**
 * Multipliers on the active interval for each consecutive idle pass. With the
 * default 20s active / 1800s idle that ramps 20s → 60s → 300s → 1800s, so a
 * torrent that goes quiet for a while is still noticed within minutes rather
 * than half an hour.
 */
const IDLE_RAMP_MULTIPLIERS = [1, 3, 15];

export function computeNextPollDelaySecs(
  hasActive: boolean,
  activeSecs: number,
  idleSecs: number,
  idlePasses = 0,
): number {
  if (hasActive) return activeSecs;
  const multiplier = IDLE_RAMP_MULTIPLIERS[idlePasses];
  if (multiplier === undefined) return idleSecs;
  return Math.min(activeSecs * multiplier, idleSecs);
}

function getOrInitTrack(
  state: ReconcileState,
  id: number,
  createdAtMs: number,
  progress: number,
  nowMs: number,
): StallTrack {
  const existing = state.stallTracks.get(id);
  if (existing) return existing;
  const track = {
    createdAtMs,
    lastProgress: progress,
    lastProgressAtMs: nowMs,
  };
  state.stallTracks.set(id, track);
  return track;
}

/**
 * Reconcile a set of pending (non-completed, non-failed) download_history rows
 * against normalized download-client state. If `treatMissingAsFailed` is true,
 * rows whose torrent is absent are marked failed and the library status
 * reverted — used by the rescan action so the UI isn't stuck on "downloading"
 * when the user deleted the torrent out-of-band.
 */
export async function reconcilePendingDownloads(
  pending: Array<{
    id: number;
    mediaId: number | null;
    episodeId: number | null;
    torrentHash: string | null;
    grabbedAt?: Date | null;
  }>,
  opts: {
    treatMissingAsFailed?: boolean;
    settings?: ReconcileSettings;
    state?: ReconcileState;
    /**
     * Torrent source. Defaults to the configured download client; passed in by
     * callers that already hold an adapter, and by tests, which then need no
     * module mocking to drive the loop.
     */
    listTorrents?: () => Promise<NormalizedTorrent[]>;
    /**
     * The transitions this loop delegates to. Defaults to the download outcome
     * module — injectable so a test can assert what the loop *decided* without
     * standing up the DB behind what the outcome then *does*.
     */
    outcome?: DownloadOutcomeHandlers;
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
  if (!listTorrents) {
    const active = await resolveActiveAdapter();
    if (!active) return result;
    listTorrents = () => active.adapter.listTorrents();
  }

  let torrents: NormalizedTorrent[];
  try {
    torrents = await listTorrents();
  } catch (error) {
    console.warn("[reconcilePendingDownloads] listTorrents failed:", error);
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
          await outcome.failDownload(
            dh,
            "torrent missing from download client",
          );
          result.missing += 1;
        }
        // The row is gone from the client either way — stop tracking it, or the
        // map grows for every torrent the user ever removed out-of-band.
        state.stallTracks.delete(dh.id);
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
        // Anything the client still intends to finish keeps the fast cadence.
        // A paused torrent is excluded — it will not move until the user acts.
        if (match.state !== "paused") state.lastReconcileHadActive = true;
        if (verdict.progressed) {
          track.lastProgress = match.progress;
          track.lastProgressAtMs = nowMs;
        }
        continue;
      }

      if (verdict.outcome === "fail") {
        await outcome.failDownload(dh, verdict.reason);
        state.stallTracks.delete(dh.id);
        result.failed += 1;
        continue;
      }

      // Prefer the hash: several rows can share it after a retry or re-grab,
      // and it also carries the recovery case for a row already marked complete
      // whose file never reached the library.
      const completedId = dh.torrentHash
        ? await outcome.completeDownloadByHash(dh.torrentHash)
        : null;
      if (completedId == null) await outcome.completeDownload(dh);
      state.stallTracks.delete(dh.id);
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

/**
 * In-flight reconcile, so overlapping triggers coalesce instead of racing.
 *
 * The scheduled-tasks worker runs at concurrency 3 and there are now three ways
 * to trigger a pass: the 20s cron tick, a hook wake, and a second hook wake from
 * a torrent that finished moments later. Without this guard two passes can read
 * the same pending snapshot; the first completes a row, and the second then hits
 * `completeDownloadByHash`'s already-complete recovery branch, which enqueues
 * post-processing with `force` — a deliberately unique job id that bypasses
 * BullMQ's dedupe. The same download would be imported twice, which is exactly
 * the duplicate-hook idempotency the hook design claims to have.
 */
let reconcileInFlight: Promise<void> | null = null;

/**
 * Run `pass`, or join the one already running.
 *
 * Awaiting the shared promise (rather than returning immediately) keeps each
 * BullMQ job's lifetime honest: it stays "active" until the work it asked for
 * has actually finished.
 *
 * Exported so the coalescing itself is testable — `checkDownloadCompletion`
 * reaches Prisma, which the test preload stubs out.
 */
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

/**
 * Above this, log that the active set is abnormally large. Deliberately a
 * warning and not a `take`: a row whose torrent is absent from the client stays
 * pending forever on a scheduled pass (reconcilePendingDownloads only fails
 * those when treatMissingAsFailed is set, which just the rescan path does), so
 * an oldest-first page could fill with orphans and starve every newer download
 * of completion and import. The query itself no longer needs a bound — the
 * partial index makes it 0.014ms at 47k rows.
 */
const PENDING_RECONCILE_WARN_AT = 500;

async function runDownloadCompletionPass(): Promise<void> {
  const [pending, settings] = await Promise.all([
    prisma.downloadHistory.findMany({
      // Served end-to-end by the partial index
      // ix_download_history_active_grabbed_at, which covers this filter AND
      // the grabbed_at sort. This runs every ~20s against a table that only
      // grows; measured at 47k rows it is 0.014ms vs 12.6ms without it.
      where: { completedAt: null, failed: false },
      select: {
        id: true,
        mediaId: true,
        episodeId: true,
        torrentHash: true,
        grabbedAt: true,
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
