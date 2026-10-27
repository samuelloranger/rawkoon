import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";

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
  | { outcome: "fail"; reason: string; failKind: "stalled" | "error" }
  | { outcome: "wait"; progressed: boolean };

export function classifyPendingAgainstTorrent(
  torrent: NormalizedTorrent,
  track: StallTrack,
  nowMs: number,
  settings: ReconcileSettings,
): PendingOutcome {
  // Completion first: a torrent that finished while Rawkoon was down is imported, not condemned.
  if (
    torrent.state === "completed" ||
    (torrent.state === "paused" && torrent.progress >= 1)
  ) {
    return { outcome: "complete" };
  }
  if (torrent.state === "error") {
    return {
      outcome: "fail",
      reason: "download client reported error state",
      failKind: "error",
    };
  }
  // Full progress without a finished state means the files are still landing
  // (rdt-client before its local download, qBittorrent moving or checking).
  if (torrent.progress >= 1) return { outcome: "wait", progressed: false };
  if (nowMs - track.createdAtMs > settings.maxAgeSecs * 1000) {
    return {
      outcome: "fail",
      reason: "exceeded max age with no completion",
      // A torrent paused on purpose is not the release's fault.
      failKind: torrent.state === "paused" ? "error" : "stalled",
    };
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
      failKind: "stalled",
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
  /** Rows whose file list was already checked clean, so the client is asked once. */
  filesChecked: Set<number>;
};

export function createReconcileState(): ReconcileState {
  return {
    stallTracks: new Map(),
    lastReconcileHadActive: false,
    idlePasses: 0,
    nextPollAtMs: 0,
    knownPendingIds: new Set(),
    filesChecked: new Set(),
  };
}

/** How long a received hook keeps the slow cadence in effect. */
export const HOOK_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export function getOrInitTrack(
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
 * True when at least two live downloads all hit the stall timeout in the same
 * pass — the signature of a VPN or network drop rather than dead releases.
 */
export function isMassStall(
  pending: Array<{
    id: number;
    torrentHash: string | null;
    grabbedAt?: Date | null;
  }>,
  torrents: NormalizedTorrent[],
  state: ReconcileState,
  nowMs: number,
  settings: ReconcileSettings,
): boolean {
  let live = 0;
  let stalled = 0;
  for (const dh of pending) {
    const match = findPendingTorrent(torrents, dh.id, dh.torrentHash);
    if (!match || match.state === "paused") continue;
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
    if (verdict.outcome === "complete") continue;
    live += 1;
    if (
      verdict.outcome === "fail" &&
      verdict.failKind === "stalled" &&
      verdict.reason !== "exceeded max age with no completion"
    ) {
      stalled += 1;
    }
  }
  return stalled >= 2 && stalled === live;
}

/** The fields rejectRelease needs, from a pending row that may predate them. */
export function rejectable(dh: {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
  torrentHash: string | null;
  releaseTitle?: string;
  indexer?: string | null;
  bookEditionId?: number | null;
  isUpgrade?: boolean;
}) {
  return {
    id: dh.id,
    mediaId: dh.mediaId,
    episodeId: dh.episodeId,
    bookEditionId: dh.bookEditionId ?? null,
    isUpgrade: dh.isUpgrade ?? false,
    torrentHash: dh.torrentHash,
    releaseTitle: dh.releaseTitle ?? "",
    indexer: dh.indexer ?? null,
  };
}
