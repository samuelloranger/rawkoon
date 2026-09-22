import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  classifyOrphans,
  governingProgress,
  indexerKey,
  resolveIndexerRule,
  sharesContentPath,
  statsOf,
  type Rule,
  type RuleContext,
} from "@rawkoon/api/services/seeding/seedPolicy";
import type {
  DownloadSeedState,
  IndexerSeedRuleRow,
  OrphansResponse,
  SeedRule,
  SeedingBadge,
  SeedingTorrent,
  SeedReleaseReason,
} from "@rawkoon/shared/types";

export interface HeldRow {
  id: number;
  torrentHash: string;
  indexer: string | null;
  grabbedAt: Date;
  mediaId: number | null;
  episodeId: number | null;
  bookEditionId: number | null;
  media: {
    id: number;
    title: string;
    year: number | null;
    posterUrl: string | null;
    type: string;
  } | null;
  book: {
    id: number;
    title: string;
    coverUrl: string | null;
    kind: string;
  } | null;
}
export interface CompletedTarget {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
  bookEditionId: number | null;
  grabbedAt: Date;
}

export const toApiRule = (rule: Rule): SeedRule => ({
  ratio: rule.ratio,
  seed_time_mins: rule.seedTimeMins,
});

const targetKey = (r: {
  mediaId: number | null;
  episodeId: number | null;
  bookEditionId: number | null;
}) =>
  r.bookEditionId != null
    ? `b:${r.bookEditionId}`
    : r.mediaId != null
      ? `m:${r.mediaId}:${r.episodeId ?? "-"}`
      : null;

export function supersededIds(
  held: HeldRow[],
  completed: CompletedTarget[],
): Set<number> {
  const newest = new Map<string, number>();
  for (const c of completed) {
    const key = targetKey(c);
    if (key)
      newest.set(key, Math.max(newest.get(key) ?? 0, c.grabbedAt.getTime()));
  }
  const out = new Set<number>();
  for (const h of held) {
    const key = targetKey(h);
    if (key && (newest.get(key) ?? 0) > h.grabbedAt.getTime()) out.add(h.id);
  }
  return out;
}

export function buildSeedingTorrents(
  rows: HeldRow[],
  torrents: NormalizedTorrent[],
  ctx: RuleContext,
  superseded: ReadonlySet<number>,
): SeedingTorrent[] {
  const byHash = new Map(torrents.map((t) => [t.hash.toLowerCase(), t]));
  const groups = new Map<string, HeldRow[]>();
  for (const r of rows) {
    const key = r.torrentHash.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: SeedingTorrent[] = [];
  for (const [hash, group] of groups) {
    const t = byHash.get(hash);
    if (!t) continue;
    const resolved = group.map((r) => resolveIndexerRule(r.indexer, ctx));
    const g = governingProgress(
      statsOf(t),
      resolved.map((x) => x.rule),
    );
    const governing = resolved.find((x) => x.rule === g.rule) ?? resolved[0];
    const named = group.find((r) => r.media || r.book) ?? group[0];
    const isPrivate = resolved.some((x) => x.isPrivate);
    const badges: SeedingBadge[] = [];
    if (group.every((r) => r.mediaId == null && r.bookEditionId == null))
      badges.push("removed_from_library");
    if (group.some((r) => superseded.has(r.id)))
      badges.push("replaced_by_upgrade");
    out.push({
      hash,
      name: t.name,
      title: named.media?.title ?? named.book?.title ?? t.name,
      year: named.media?.year ?? null,
      kind_label: named.media
        ? named.media.type === "show"
          ? "show"
          : "movie"
        : named.book
          ? named.book.kind === "audiobook"
            ? "audiobook"
            : "ebook"
          : null,
      media_id: named.media?.id ?? null,
      book_id: named.book?.id ?? null,
      poster_url: named.media?.posterUrl ?? named.book?.coverUrl ?? null,
      indexer: named.indexer,
      is_private: isPrivate,
      badges,
      rule: toApiRule(g.rule),
      rule_source: governing?.source ?? "private_default",
      ratio: t.ratio,
      seeding_time_secs: t.seedingTimeSecs,
      up_speed: t.upSpeed,
      size_bytes: t.sizeBytes,
      ratio_pct: g.ratioPct,
      time_pct: g.timePct,
      lead: g.lead,
      eta_secs: g.etaSecs,
      target_met: g.met,
      owes_seed_time: isPrivate && !g.met,
    });
  }
  // Soonest release first; unreachable (null ETA) last.
  return out.sort(
    (a, b) =>
      (a.eta_secs ?? Number.POSITIVE_INFINITY) -
      (b.eta_secs ?? Number.POSITIVE_INFINITY),
  );
}

export function buildOrphans(
  torrents: NormalizedTorrent[],
  ownedHashes: ReadonlySet<string>,
): OrphansResponse {
  const orphans = classifyOrphans(torrents, ownedHashes).map((t) => ({
    hash: t.hash.toLowerCase(),
    name: t.name,
    category: t.category,
    size_bytes: t.sizeBytes,
    ratio: t.ratio,
    seeding_time_secs: t.seedingTimeSecs,
    content_path: t.contentPath,
    shares_data: sharesContentPath(t, torrents),
  }));
  return {
    orphans,
    total_bytes: orphans.reduce((sum, o) => sum + o.size_bytes, 0),
  };
}

export function buildSeedRuleRows(
  indexers: Array<{ name: string; isPrivate: boolean }>,
  overrides: Array<{
    indexerName: string;
    ratio: number | null;
    seedTimeMins: number | null;
  }>,
  heldByIndexer: ReadonlyMap<string, number>,
  ctx: RuleContext,
): IndexerSeedRuleRow[] {
  const names = new Map<string, string>();
  for (const i of indexers) names.set(i.name.toLowerCase(), i.name);
  for (const o of overrides)
    if (!names.has(o.indexerName.toLowerCase()))
      names.set(o.indexerName.toLowerCase(), o.indexerName);
  const overrideByKey = new Map(
    overrides.map((o) => [o.indexerName.toLowerCase(), o]),
  );
  const privacy = new Map(ctx.privacy);
  for (const i of indexers) privacy.set(i.name.toLowerCase(), i.isPrivate);
  return [...names.entries()]
    .map(([key, name]) => {
      const o = overrideByKey.get(key);
      const resolved = resolveIndexerRule(name, {
        ...ctx,
        privacy,
        overrides: o
          ? new Map([[key, { ratio: o.ratio, seedTimeMins: o.seedTimeMins }]])
          : new Map(),
      });
      return {
        indexer: name,
        is_private: resolved.isPrivate,
        override: o ? { ratio: o.ratio, seed_time_mins: o.seedTimeMins } : null,
        effective: toApiRule(resolved.rule),
        source: resolved.source,
        held_count: heldByIndexer.get(indexerKey(name) ?? "") ?? 0,
      };
    })
    .sort((a, b) => a.indexer.localeCompare(b.indexer));
}

const BLOCKLIST_REASONS = new Set(["stalled", "malware", "import_rejected"]);

export function seedStateForRow(
  row: {
    failed: boolean;
    completedAt: Date | null;
    seedReleasedAt: Date | null;
    seedReleaseReason: string | null;
  },
  torrent: NormalizedTorrent | undefined,
): DownloadSeedState | null {
  const reason = (row.seedReleaseReason as SeedReleaseReason | null) ?? null;
  if (reason && BLOCKLIST_REASONS.has(reason)) {
    return {
      state: "blocklisted",
      reason,
      ratio: null,
      seeding_time_secs: null,
    };
  }
  // Adopted rows are stamped at adoption; say so only once the download is done.
  if (reason === "adopted" && !row.completedAt) return null;
  if (row.seedReleasedAt)
    return { state: "released", reason, ratio: null, seeding_time_secs: null };
  if (row.completedAt && !row.failed && torrent) {
    return {
      state: "seeding",
      reason: null,
      ratio: torrent.ratio,
      seeding_time_secs: torrent.seedingTimeSecs,
    };
  }
  return null;
}
