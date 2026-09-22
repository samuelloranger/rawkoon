import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type {
  DownloadClientAdapter,
  NormalizedTorrent,
} from "@rawkoon/api/services/downloadClient/types";
import { emitSeedState } from "@rawkoon/api/services/libraryEvents";
import { loadIndexerPrivacy } from "@rawkoon/api/services/seeding/indexerPrivacy";
import {
  governingProgress,
  isRawkoonOwned,
  resolveIndexerRule,
  type RuleContext,
  type SeedProgress,
  sharesContentPath,
  statsOf,
} from "@rawkoon/api/services/seeding/seedPolicy";
import type { SeedReleaseReason, SeedStateItem } from "@rawkoon/shared/types";

export interface SweepRow {
  id: number;
  torrentHash: string;
  indexer: string | null;
}
export interface SweepContext extends RuleContext {
  moveMode: boolean;
  pendingHashes: ReadonlySet<string>;
}
export type SweepDecision =
  | {
      hash: string;
      action: "stamp";
      reason: "manual" | "adopted";
      rowIds: number[];
    }
  | {
      hash: string;
      action: "skip";
      why: "pending" | "downloading" | "not_met";
      rowIds: number[];
      torrent: NormalizedTorrent;
      progress: SeedProgress;
    }
  | {
      hash: string;
      action: "release";
      reason: "target_met" | "move_mode";
      rowIds: number[];
      deleteData: boolean;
      torrent: NormalizedTorrent;
      progress: SeedProgress;
    };

export interface SweepDeps {
  isEnabled: () => Promise<boolean>;
  loadContext: () => Promise<RuleContext & { moveMode: boolean }>;
  loadRows: (hash?: string) => Promise<SweepRow[]>;
  loadPendingHashes: () => Promise<Set<string>>;
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
  stamp: (
    rowIds: number[],
    reason: SeedReleaseReason,
    bytes: bigint | null,
  ) => Promise<void>;
  emit: (items: SeedStateItem[]) => void;
}

function groupByHash(rows: SweepRow[]): Map<string, SweepRow[]> {
  const groups = new Map<string, SweepRow[]>();
  for (const row of rows) {
    const key = row.torrentHash.trim().toLowerCase();
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export function planSeedReleases(
  rows: SweepRow[],
  torrents: NormalizedTorrent[],
  ctx: SweepContext,
): SweepDecision[] {
  const byHash = new Map(torrents.map((t) => [t.hash.toLowerCase(), t]));
  const decisions: SweepDecision[] = [];
  for (const [hash, group] of groupByHash(rows)) {
    const rowIds = group.map((r) => r.id);
    const torrent = byHash.get(hash);
    if (!torrent) {
      decisions.push({ hash, action: "stamp", reason: "manual", rowIds });
      continue;
    }
    const progress = governingProgress(
      statsOf(torrent),
      group.map((r) => resolveIndexerRule(r.indexer, ctx).rule),
    );
    if (ctx.pendingHashes.has(hash)) {
      decisions.push({
        hash,
        action: "skip",
        why: "pending",
        rowIds,
        torrent,
        progress,
      });
    } else if (torrent.progress < 1) {
      decisions.push({
        hash,
        action: "skip",
        why: "downloading",
        rowIds,
        torrent,
        progress,
      });
    } else if (!isRawkoonOwned(torrent)) {
      decisions.push({ hash, action: "stamp", reason: "adopted", rowIds });
    } else if (ctx.moveMode || progress.met) {
      decisions.push({
        hash,
        action: "release",
        reason: ctx.moveMode ? "move_mode" : "target_met",
        rowIds,
        deleteData: !sharesContentPath(torrent, torrents),
        torrent,
        progress,
      });
    } else {
      decisions.push({
        hash,
        action: "skip",
        why: "not_met",
        rowIds,
        torrent,
        progress,
      });
    }
  }
  return decisions;
}

export async function loadSeedContext(): Promise<
  RuleContext & { moveMode: boolean }
> {
  const [settings, overrides, privacy] = await Promise.all([
    prisma.mediaSettings.findUnique({ where: { id: 1 } }),
    prisma.indexerSeedRule.findMany(),
    loadIndexerPrivacy(),
  ]);
  return {
    defaults: {
      // minSeedRatio <= 0 already meant "no ratio target" before this release.
      publicRule: {
        ratio: settings
          ? settings.minSeedRatio > 0
            ? settings.minSeedRatio
            : null
          : 1,
        seedTimeMins: settings?.publicSeedTimeMins ?? null,
      },
      privateRule: {
        ratio: settings ? settings.privateSeedRatio : 1,
        seedTimeMins: settings ? settings.privateSeedTimeMins : 4320,
      },
    },
    overrides: new Map(
      overrides.map((o) => [
        o.indexerName.trim().toLowerCase(),
        { ratio: o.ratio, seedTimeMins: o.seedTimeMins },
      ]),
    ),
    privacy,
    moveMode: settings?.fileOperation === "move",
  };
}

export const defaultSweepDeps: SweepDeps = {
  isEnabled: async () =>
    (
      await prisma.mediaSettings.findUnique({
        where: { id: 1 },
        select: { seedSweepEnabled: true },
      })
    )?.seedSweepEnabled ?? false,
  loadContext: loadSeedContext,
  loadRows: async (hash) => {
    const rows = await prisma.downloadHistory.findMany({
      where: {
        completedAt: { not: null },
        failed: false,
        seedReleasedAt: null,
        torrentHash: hash
          ? { equals: hash, mode: "insensitive" }
          : { not: null },
      },
      select: { id: true, torrentHash: true, indexer: true },
    });
    return rows.flatMap((r) =>
      r.torrentHash
        ? [{ id: r.id, torrentHash: r.torrentHash, indexer: r.indexer }]
        : [],
    );
  },
  loadPendingHashes: async () => {
    const rows = await prisma.downloadHistory.findMany({
      where: { completedAt: null, failed: false, torrentHash: { not: null } },
      select: { torrentHash: true },
    });
    return new Set(
      rows.flatMap((r) => (r.torrentHash ? [r.torrentHash.toLowerCase()] : [])),
    );
  },
  resolveAdapter: async () => (await resolveActiveAdapter())?.adapter ?? null,
  stamp: async (rowIds, reason, bytes) => {
    await prisma.downloadHistory.updateMany({
      where: { id: { in: rowIds } },
      data: {
        seedReleasedAt: new Date(),
        seedReleaseReason: reason,
        seedReleasedBytes: bytes,
      },
    });
  },
  emit: emitSeedState,
};

function liveItem(
  torrent: NormalizedTorrent,
  progress: SeedProgress,
): SeedStateItem {
  return {
    hash: torrent.hash.toLowerCase(),
    ratio: torrent.ratio,
    seedingTimeSecs: torrent.seedingTimeSecs,
    upSpeed: torrent.upSpeed,
    etaSecs: progress.etaSecs,
  };
}

export async function runSeedSweep(
  deps: SweepDeps = defaultSweepDeps,
  opts: { hash?: string } = {},
): Promise<SweepDecision[]> {
  if (!(await deps.isEnabled())) return [];
  const adapter = await deps.resolveAdapter();
  if (!adapter) return [];
  let torrents: NormalizedTorrent[];
  try {
    torrents = await adapter.listTorrents();
  } catch (error) {
    console.warn("[seedSweep] listTorrents failed, retrying next pass:", error);
    return [];
  }
  const [rows, pendingHashes, base] = await Promise.all([
    deps.loadRows(opts.hash?.toLowerCase()),
    deps.loadPendingHashes(),
    deps.loadContext(),
  ]);
  const decisions = planSeedReleases(rows, torrents, {
    ...base,
    pendingHashes,
  });
  const items: SeedStateItem[] = [];
  for (const d of decisions) {
    if (d.action === "stamp") {
      await deps.stamp(d.rowIds, d.reason, null);
    } else if (d.action === "skip") {
      items.push(liveItem(d.torrent, d.progress));
    } else {
      try {
        await adapter.remove(d.torrent.hash, d.deleteData);
        await deps.stamp(d.rowIds, d.reason, BigInt(d.torrent.sizeBytes));
        items.push({
          ...liveItem(d.torrent, d.progress),
          released: {
            reason: d.reason,
            at: new Date().toISOString(),
            freedBytes: d.deleteData ? d.torrent.sizeBytes : null,
          },
        });
      } catch (error) {
        console.warn(
          `[seedSweep] could not release ${d.hash}, retrying next pass:`,
          error,
        );
      }
    }
  }
  deps.emit(items);
  return decisions;
}

/** Post-import hook: release right away if the target is already met (or move mode). */
export async function evaluateSeedRelease(hash: string): Promise<void> {
  await runSeedSweep(defaultSweepDeps, { hash });
}

export type ManualReleaseResult =
  | { status: "released"; freedBytes: number | null }
  | { status: "pending" }
  | { status: "adopted" }
  | { status: "not_found" }
  | { status: "unavailable" };

/** "Remove now": an explicit admin action, so it ignores both the target and the sweep switch. */
export async function releaseTorrentNow(
  hash: string,
  deps: SweepDeps = defaultSweepDeps,
): Promise<ManualReleaseResult> {
  const key = hash.trim().toLowerCase();
  const [rows, pending] = await Promise.all([
    deps.loadRows(key),
    deps.loadPendingHashes(),
  ]);
  if (rows.length === 0) return { status: "not_found" };
  if (pending.has(key)) return { status: "pending" };
  const adapter = await deps.resolveAdapter();
  if (!adapter) return { status: "unavailable" };
  const rowIds = rows.map((r) => r.id);
  const torrents = await adapter.listTorrents();
  const torrent = torrents.find((t) => t.hash.toLowerCase() === key);
  if (!torrent) {
    await deps.stamp(rowIds, "manual", null);
    return { status: "released", freedBytes: null };
  }
  if (!isRawkoonOwned(torrent)) {
    await deps.stamp(rowIds, "adopted", null);
    return { status: "adopted" };
  }
  const deleteData = !sharesContentPath(torrent, torrents);
  await adapter.remove(torrent.hash, deleteData);
  await deps.stamp(rowIds, "manual", BigInt(torrent.sizeBytes));
  const freedBytes = deleteData ? torrent.sizeBytes : null;
  deps.emit([
    {
      hash: key,
      ratio: torrent.ratio,
      seedingTimeSecs: torrent.seedingTimeSecs,
      upSpeed: torrent.upSpeed,
      etaSecs: 0,
      released: { reason: "manual", at: new Date().toISOString(), freedBytes },
    },
  ]);
  return { status: "released", freedBytes };
}
export interface AbandonDeps {
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
  markAbandoned: (ids: number[]) => Promise<void>;
}

const defaultAbandonDeps: AbandonDeps = {
  resolveAdapter: async () => (await resolveActiveAdapter())?.adapter ?? null,
  markAbandoned: async (ids) => {
    await prisma.downloadHistory.updateMany({
      where: { id: { in: ids } },
      data: {
        failed: true,
        failReason: "Removed from library",
        seedReleasedAt: new Date(),
        seedReleaseReason: "manual",
      },
    });
  },
};

/** A grab still downloading when its title is removed can never import; stop it instead of letting it finish. */
export async function abandonPendingDownloads(
  rows: Array<{ id: number; torrentHash: string | null }>,
  deps: AbandonDeps = defaultAbandonDeps,
): Promise<void> {
  if (rows.length === 0) return;
  await deps.markAbandoned(rows.map((r) => r.id));
  const hashes = new Set(
    rows.flatMap((r) =>
      r.torrentHash ? [r.torrentHash.trim().toLowerCase()] : [],
    ),
  );
  if (hashes.size === 0) return;
  const adapter = await deps.resolveAdapter();
  if (!adapter) return;
  try {
    const torrents = await adapter.listTorrents();
    for (const torrent of torrents) {
      if (!hashes.has(torrent.hash.toLowerCase()) || !isRawkoonOwned(torrent))
        continue;
      await adapter.remove(torrent.hash, !sharesContentPath(torrent, torrents));
    }
  } catch (error) {
    console.warn("[seedSweep] could not remove abandoned torrents:", error);
  }
}
