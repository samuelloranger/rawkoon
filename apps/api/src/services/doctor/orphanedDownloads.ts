import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import type { CheckOutcome } from "./status";

/** One top-level entry of the downloads folder, as scanned from disk. */
export interface DownloadEntry {
  name: string;
  sizeBytes: number;
  /** Newest mtime of the entry or anything inside it. */
  newestMtimeMs: number;
  /** Some file inside is hardlinked into the library. */
  linkedToLibrary: boolean;
}

export type TorrentLocation = Pick<
  NormalizedTorrent,
  "name" | "contentPath" | "savePath"
>;

// In-flight imports and fresh downloads get a grace period before they count.
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
const LISTED_NAMES = 10;

const segments = (p: string | null) => (p ? p.split(/[\\/]+/) : []);

/** Name-based so it holds when the client sees the folder under another mount path. */
function belongsToTorrent(name: string, torrents: readonly TorrentLocation[]) {
  return torrents.some(
    (t) =>
      t.name === name || segments(t.contentPath ?? t.savePath).includes(name),
  );
}

/** Pure: entries nothing references — no torrent, no library hardlink, not fresh. */
export function selectOrphans(
  entries: readonly DownloadEntry[],
  torrents: readonly TorrentLocation[],
  nowMs: number,
): DownloadEntry[] {
  return entries.filter(
    (e) =>
      !e.linkedToLibrary &&
      nowMs - e.newestMtimeMs >= ORPHAN_MIN_AGE_MS &&
      !belongsToTorrent(e.name, torrents),
  );
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function evaluateOrphans(
  orphans: readonly DownloadEntry[],
): CheckOutcome {
  if (orphans.length === 0) {
    return {
      status: "ok",
      summary: "No orphaned files in the downloads folder.",
      fix: null,
    };
  }
  const total = orphans.reduce((sum, e) => sum + e.sizeBytes, 0);
  const names = orphans.slice(0, LISTED_NAMES).map((e) => e.name);
  const more = orphans.length - names.length;
  return {
    status: "warn",
    summary: `${orphans.length} ${
      orphans.length === 1 ? "item" : "items"
    } (${formatBytes(total)}) in the downloads folder belong to no torrent and are not linked into the library: ${names.join(", ")}${
      more > 0 ? `, and ${more} more` : ""
    }.`,
    fix: "Review them and delete the ones you no longer need from the downloads folder (rm -r on the host); Rawkoon never deletes them itself.",
  };
}
