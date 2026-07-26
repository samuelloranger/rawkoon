import type { NormalizedState } from "./types";

const QB_COMPLETED = new Set([
  "uploading",
  "pausedUP",
  "stoppedUP",
  "stalledUP",
  "queuedUP",
  "forcedUP",
]);
const QB_ERROR = new Set(["error", "missingFiles"]);
const QB_PAUSED = new Set(["pausedDL", "stoppedDL"]);

export function normalizeQbState(raw: string): NormalizedState {
  if (QB_COMPLETED.has(raw)) return "completed";
  if (QB_ERROR.has(raw)) return "error";
  if (raw === "stalledDL") return "stalled";
  if (QB_PAUSED.has(raw)) return "paused";
  return "downloading";
}

export function normalizeTransmissionState(
  status: number,
  opts: {
    isStalled?: boolean;
    errorNo?: number;
    percentDone: number;
  },
): NormalizedState {
  if ((opts.errorNo ?? 0) > 0) return "error";
  if (status === 5 || status === 6 || opts.percentDone >= 1) {
    return "completed";
  }
  if (status === 0) return "paused";
  if (opts.isStalled) return "stalled";
  return "downloading";
}

export function normalizeDelugeState(raw: string): NormalizedState {
  if (raw === "Seeding") return "completed";
  if (raw === "Error") return "error";
  if (raw === "Paused") return "paused";
  return "downloading";
}
