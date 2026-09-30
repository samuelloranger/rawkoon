export type DurationRounding = "floor" | "round" | "ceil";

function finiteNonNegative(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

function minutesOf(secs: number, rounding: DurationRounding): number {
  const minutes = secs / 60;
  switch (rounding) {
    case "round":
      return Math.round(minutes);
    case "ceil":
      return Math.ceil(minutes);
    default:
      return Math.floor(minutes);
  }
}

function compactFromMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Download ETA: whole seconds under a minute, then the same compact
 * hour/minute shape as file durations. Null when absent or invalid so a
 * chip can be omitted.
 */
export function formatEtaSeconds(
  secs: number | null | undefined,
): string | null {
  if (!finiteNonNegative(secs)) return null;
  if (secs < 60) return `${Math.floor(secs)}s`;
  return formatDurationCompactSeconds(secs);
}

/**
 * Compact duration (`2h 5m`, `45m`). Zero and invalid input are null.
 * `minMinutes` hides anything shorter (library rows skip sub-minute files).
 * Rounding is applied to the whole minute count, so 59.5 rounded minutes
 * becomes `1h 0m` rather than `60m`.
 */
export function formatDurationCompactSeconds(
  secs: number | null | undefined,
  opts?: { rounding?: DurationRounding; minMinutes?: number },
): string | null {
  if (!finiteNonNegative(secs) || secs === 0) return null;
  const totalMinutes = minutesOf(secs, opts?.rounding ?? "floor");
  if (opts?.minMinutes != null && totalMinutes < opts.minMinutes) return null;
  return compactFromMinutes(totalMinutes);
}

/** TMDB runtime is already in minutes. Same shape as file durations. */
export function formatRuntimeMinutes(
  minutes: number | null | undefined,
): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return formatDurationCompactSeconds(minutes * 60);
}

/** Playback clock. Floors, so the label never runs ahead of the playhead. */
export function formatDurationClockSeconds(
  secs: number | null | undefined,
): string {
  if (!finiteNonNegative(secs) || secs === 0) return "0:00";
  const total = Math.floor(secs);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rem = total % 60;
  const ss = String(rem).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/** Job durations stored in milliseconds: `12ms`, `1.5s`, `1.5m`. */
export function formatDurationMsShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/** Listening stats: sub-minute stays `0h`, otherwise unpadded hours and minutes. */
export function formatListeningHours(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "0h";
  const total = Math.floor(secs);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0 && minutes === 0) return "0h";
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
