import type { DownloadProgressItem } from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  emitDownloadProgress,
  libraryEventBus,
} from "@rawkoon/api/services/libraryEvents";

/** How often to poll the download client and fan progress out. */
export const DOWNLOAD_PROGRESS_INTERVAL_MS = 3000;

/** The download_history fields the broadcaster reads — nothing more. */
export interface ActiveDownloadRow {
  id: number;
  mediaId: number | null;
  completedAt: Date | null;
  failed: boolean;
  torrentHash: string | null;
}

/** A row is worth polling only while it is genuinely in flight. */
function isActiveRow(row: ActiveDownloadRow): boolean {
  return row.completedAt === null && !row.failed && row.torrentHash !== null;
}

/** Lowercased torrent hashes of the rows still downloading. */
export function selectActiveDownloadHashes(
  rows: ActiveDownloadRow[],
): string[] {
  return rows
    .filter(isActiveRow)
    .map((row) => (row.torrentHash as string).toLowerCase());
}

/**
 * Match active rows to their torrents by hash and group the live numbers by
 * media. A row whose torrent is absent from the client is skipped — no torrent,
 * nothing to report — so the grouping only ever carries rows with fresh data.
 */
export function buildProgressPayload(
  rows: ActiveDownloadRow[],
  torrents: NormalizedTorrent[],
): Map<number, DownloadProgressItem[]> {
  const byHash = new Map<string, NormalizedTorrent>();
  for (const torrent of torrents) {
    byHash.set(torrent.hash.toLowerCase(), torrent);
  }

  const grouped = new Map<number, DownloadProgressItem[]>();
  for (const row of rows) {
    if (!isActiveRow(row) || row.mediaId === null) continue;
    const torrent = byHash.get((row.torrentHash as string).toLowerCase());
    if (!torrent) continue;

    const item: DownloadProgressItem = {
      id: row.id,
      progress: torrent.progress,
      state: torrent.state,
      downloadSpeed: torrent.dlSpeed,
      etaSeconds: null,
    };
    const list = grouped.get(row.mediaId);
    if (list) list.push(item);
    else grouped.set(row.mediaId, [item]);
  }
  return grouped;
}

/**
 * Skip the whole tick — no client poll, no work — unless someone is listening
 * on the SSE stream AND there is a live download to report on.
 */
export function shouldBroadcast(
  listenerCount: number,
  activeRowCount: number,
): boolean {
  return listenerCount > 0 && activeRowCount > 0;
}

/** Rows currently in flight, straight from the DB. */
async function fetchActiveRows(): Promise<ActiveDownloadRow[]> {
  return prisma.downloadHistory.findMany({
    where: { completedAt: null, failed: false, torrentHash: { not: null } },
    select: {
      id: true,
      mediaId: true,
      completedAt: true,
      failed: true,
      torrentHash: true,
    },
  });
}

/**
 * One broadcast pass: gate, poll the client once, fan the numbers out. Never
 * mutates state — completion and stall detection stay with the reconcile
 * worker. Returns whether it emitted, for tests.
 */
export async function runDownloadProgressPass(deps: {
  listenerCount: () => number;
  activeRows: () => Promise<ActiveDownloadRow[]>;
  listTorrents: () => Promise<NormalizedTorrent[] | null>;
  emit: (mediaId: number, downloads: DownloadProgressItem[]) => void;
}): Promise<boolean> {
  if (deps.listenerCount() <= 0) return false;

  const rows = await deps.activeRows();
  if (!shouldBroadcast(deps.listenerCount(), rows.length)) return false;

  let torrents: NormalizedTorrent[] | null;
  try {
    torrents = await deps.listTorrents();
  } catch {
    return false; // client unreachable: reconcile worker owns failure semantics
  }
  if (!torrents) return false;

  const grouped = buildProgressPayload(rows, torrents);
  for (const [mediaId, downloads] of grouped) {
    deps.emit(mediaId, downloads);
  }
  return grouped.size > 0;
}

/** Resolve the active client and list its torrents, or null if none/unreachable. */
async function listActiveTorrents(): Promise<NormalizedTorrent[] | null> {
  const { resolveActiveAdapter } = await import(
    "@rawkoon/api/services/downloadClient/registry"
  );
  const active = await resolveActiveAdapter();
  if (!active) return null;
  return active.adapter.listTorrents();
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the production broadcaster loop. Idempotent. */
export function startDownloadProgressBroadcaster(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runDownloadProgressPass({
      listenerCount: () => libraryEventBus.listenerCount("update"),
      activeRows: fetchActiveRows,
      listTorrents: listActiveTorrents,
      emit: emitDownloadProgress,
    }).catch((err) => {
      console.warn("[downloadProgressBroadcaster] pass failed:", err);
    });
  }, DOWNLOAD_PROGRESS_INTERVAL_MS);
  // Don't keep the process alive for progress polling alone.
  timer.unref?.();
}

/** Stop the loop (tests / shutdown). */
export function stopDownloadProgressBroadcaster(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
