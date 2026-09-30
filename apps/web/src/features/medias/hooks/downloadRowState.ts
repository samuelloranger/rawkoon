import type { LibraryDownloadHistoryItem } from "@rawkoon/shared/types";
import { formatEtaSeconds } from "@rawkoon/shared/utils";
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
  const eta = formatEtaSeconds(live.eta_seconds);
  if (eta) chips.push(`ETA ${eta}`);
  return chips;
}
