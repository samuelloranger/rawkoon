import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { DownloadClientAdapter } from "@rawkoon/api/services/downloadClient/types";
import { taggedRowIds } from "@rawkoon/api/services/seeding/seedPolicy";
import { buildOrphans } from "@rawkoon/api/services/seeding/seedingView";
import { emitSeedState } from "@rawkoon/api/services/libraryEvents";
import type {
  RemoveOrphansResponse,
  SeedStateItem,
} from "@rawkoon/shared/types";

export interface OrphanDeps {
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
  /** Lowercased hashes referenced by a non-failed download_history row. */
  ownedHashes: () => Promise<Set<string>>;
  /** The subset of `ids` that are non-failed download_history rows. */
  ownedRowIds: (ids: number[]) => Promise<Set<number>>;
  /** Live update for open Downloads pages; optional so callers can stay silent. */
  emit?: (items: SeedStateItem[]) => void;
}

export async function loadOwnedRowIds(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.downloadHistory.findMany({
    where: { id: { in: ids }, failed: false },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export async function loadOwnedHashes(): Promise<Set<string>> {
  const rows = await prisma.downloadHistory.findMany({
    where: { failed: false, torrentHash: { not: null } },
    select: { torrentHash: true },
    distinct: ["torrentHash"],
  });
  return new Set(
    rows.flatMap((r) => (r.torrentHash ? [r.torrentHash.toLowerCase()] : [])),
  );
}

const defaultDeps: OrphanDeps = {
  resolveAdapter: async () => (await resolveActiveAdapter())?.adapter ?? null,
  ownedHashes: loadOwnedHashes,
  ownedRowIds: loadOwnedRowIds,
  emit: emitSeedState,
};

/**
 * Remove the requested torrents that are still orphans. Re-classified here so
 * a caller can never remove a torrent Rawkoon owns; shared data is always kept.
 * Returns null when the client is not configured or unreachable.
 */
export async function removeOrphanTorrents(
  hashes: string[],
  deleteData: boolean,
  deps: OrphanDeps = defaultDeps,
): Promise<RemoveOrphansResponse | null> {
  const adapter = await deps.resolveAdapter();
  if (!adapter) return null;
  const torrents = await adapter.listTorrents().catch(() => null);
  if (!torrents) return null;
  const { orphans } = buildOrphans(
    torrents,
    await deps.ownedHashes(),
    await deps.ownedRowIds(torrents.flatMap(taggedRowIds)),
  );
  const byHash = new Map(orphans.map((o) => [o.hash, o]));
  const removed: string[] = [];
  const pushed: SeedStateItem[] = [];
  const refused: string[] = [];
  let freed = 0;
  for (const raw of hashes) {
    const key = raw.toLowerCase();
    const orphan = byHash.get(key);
    const torrent = torrents.find((t) => t.hash.toLowerCase() === key);
    if (!orphan || !torrent) {
      refused.push(key);
      continue;
    }
    const withData = deleteData && !orphan.shares_data;
    try {
      await adapter.remove(torrent.hash, withData);
      removed.push(orphan.hash);
      if (withData) freed += orphan.size_bytes;
      pushed.push({
        hash: orphan.hash,
        ratio: orphan.ratio,
        seedingTimeSecs: orphan.seeding_time_secs,
        upSpeed: 0,
        etaSecs: 0,
        released: {
          reason: "manual",
          at: new Date().toISOString(),
          freedBytes: withData ? orphan.size_bytes : null,
        },
      });
    } catch (error) {
      console.warn(`[orphans] could not remove ${key}:`, error);
      refused.push(key);
    }
  }
  if (pushed.length > 0) deps.emit?.(pushed);
  return { removed, refused, freed_bytes: freed };
}
