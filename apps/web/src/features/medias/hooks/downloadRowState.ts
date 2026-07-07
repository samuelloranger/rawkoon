import type { LibraryDownloadHistoryItem } from "@rawkoon/shared/types";
import type { TFunction } from "i18next";

export function isDownloadInProgress(row: LibraryDownloadHistoryItem): boolean {
  return !row.completed_at && !row.failed;
}

export function isPausedState(state: string | undefined | null): boolean {
  if (!state) return false;
  return state.startsWith("paused") || state.startsWith("stopped");
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000)
    return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_000) return `${Math.round(bytesPerSec / 1_000)} KB/s`;
  return `${bytesPerSec} B/s`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function formatLiveStats(
  live: NonNullable<LibraryDownloadHistoryItem["live"]>,
  t: TFunction,
): string[] {
  const chips: string[] = [`${Math.round(live.progress * 100)}%`];
  if (isPausedState(live.state)) {
    chips.push(t("library.download.paused"));
    return chips;
  }
  if (live.download_speed > 0)
    chips.push(`↓ ${formatSpeed(live.download_speed)}`);
  if (live.eta_seconds != null)
    chips.push(`ETA ${formatEta(live.eta_seconds)}`);
  return chips;
}
