import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";

export type Rule = { ratio: number | null; seedTimeMins: number | null };
export type RuleSource = "override" | "private_default" | "public_default";
export interface SeedDefaults {
  publicRule: Rule;
  privateRule: Rule;
}
export interface RuleContext {
  defaults: SeedDefaults;
  overrides: ReadonlyMap<string, Rule>;
  privacy: ReadonlyMap<string, boolean>;
}
export interface SeedStats {
  ratio: number | null;
  seedingTimeSecs: number | null;
  upSpeed: number;
  sizeBytes: number;
}
export interface SeedProgress {
  ratioPct: number | null;
  timePct: number | null;
  lead: "ratio" | "time" | null;
  etaSecs: number | null;
  met: boolean;
}

const RAWKOON_TAG = /^rawkoon-dh-(\d+)$/i;

export function indexerKey(indexer: string | null | undefined): string | null {
  const key = indexer?.trim().toLowerCase();
  return key ? key : null;
}

export function isIndexerPrivate(
  indexer: string | null | undefined,
  privacy: ReadonlyMap<string, boolean>,
): boolean {
  const key = indexerKey(indexer);
  // Unknown counts as private: seeding too long is the safe mistake.
  return key ? (privacy.get(key) ?? true) : true;
}

export function resolveIndexerRule(
  indexer: string | null | undefined,
  ctx: RuleContext,
): { rule: Rule; source: RuleSource; isPrivate: boolean } {
  const key = indexerKey(indexer);
  const isPrivate = isIndexerPrivate(indexer, ctx.privacy);
  const override = key ? ctx.overrides.get(key) : undefined;
  if (override)
    return {
      rule: withoutZeroTargets(override),
      source: "override",
      isPrivate,
    };
  return isPrivate
    ? {
        rule: withoutZeroTargets(ctx.defaults.privateRule),
        source: "private_default",
        isPrivate,
      }
    : {
        rule: withoutZeroTargets(ctx.defaults.publicRule),
        source: "public_default",
        isPrivate,
      };
}

/** A 0 target means "no target", like minSeedRatio 0 always did — never "met immediately". */
function withoutZeroTargets(rule: Rule): Rule {
  return {
    ratio: rule.ratio != null && rule.ratio > 0 ? rule.ratio : null,
    seedTimeMins:
      rule.seedTimeMins != null && rule.seedTimeMins > 0
        ? rule.seedTimeMins
        : null,
  };
}

export function isSeedTargetMet(stats: SeedStats, rule: Rule): boolean {
  if (rule.ratio == null && rule.seedTimeMins == null) return true;
  if (rule.ratio != null && stats.ratio != null && stats.ratio >= rule.ratio)
    return true;
  return (
    rule.seedTimeMins != null &&
    stats.seedingTimeSecs != null &&
    stats.seedingTimeSecs >= rule.seedTimeMins * 60
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function seedProgress(stats: SeedStats, rule: Rule): SeedProgress {
  const met = isSeedTargetMet(stats, rule);
  const ratioPct =
    rule.ratio != null && rule.ratio > 0
      ? clamp01((stats.ratio ?? 0) / rule.ratio)
      : null;
  const timePct =
    rule.seedTimeMins != null && rule.seedTimeMins > 0
      ? clamp01((stats.seedingTimeSecs ?? 0) / (rule.seedTimeMins * 60))
      : null;
  if (rule.ratio == null && rule.seedTimeMins == null) {
    return { ratioPct, timePct, lead: null, etaSecs: 0, met };
  }
  const etas: Array<{ lead: "ratio" | "time"; secs: number }> = [];
  if (rule.ratio != null) {
    const remaining =
      Math.max(0, rule.ratio - (stats.ratio ?? 0)) * stats.sizeBytes;
    if (remaining === 0) etas.push({ lead: "ratio", secs: 0 });
    else if (stats.upSpeed > 0)
      etas.push({ lead: "ratio", secs: Math.round(remaining / stats.upSpeed) });
  }
  if (rule.seedTimeMins != null) {
    etas.push({
      lead: "time",
      secs: Math.max(0, rule.seedTimeMins * 60 - (stats.seedingTimeSecs ?? 0)),
    });
  }
  if (etas.length === 0) {
    return {
      ratioPct,
      timePct,
      lead: rule.ratio != null ? "ratio" : null,
      etaSecs: null,
      met,
    };
  }
  const soonest = etas.reduce((a, b) => (b.secs < a.secs ? b : a));
  return {
    ratioPct,
    timePct,
    lead: soonest.lead,
    etaSecs: met ? 0 : soonest.secs,
    met,
  };
}

export function governingProgress(
  stats: SeedStats,
  rules: Rule[],
): SeedProgress & { rule: Rule } {
  const evaluated = rules.map((rule) => ({
    rule,
    p: seedProgress(stats, rule),
  }));
  const unmet = evaluated.filter((e) => !e.p.met);
  if (unmet.length === 0) {
    const first = evaluated[0] ?? {
      rule: { ratio: null, seedTimeMins: null },
      p: seedProgress(stats, { ratio: null, seedTimeMins: null }),
    };
    return { ...first.p, met: true, rule: first.rule };
  }
  // Null ETA (unreachable) is the longest wait of all.
  const slowest = unmet.reduce((a, b) =>
    (b.p.etaSecs ?? Number.POSITIVE_INFINITY) >
    (a.p.etaSecs ?? Number.POSITIVE_INFINITY)
      ? b
      : a,
  );
  return { ...slowest.p, met: false, rule: slowest.rule };
}

export function isRawkoonOwned(
  t: Pick<NormalizedTorrent, "category" | "labels">,
): boolean {
  if (t.category?.toLowerCase().startsWith("rawkoon-")) return true;
  return t.labels.some((label) => RAWKOON_TAG.test(label.trim()));
}

const normPath = (p: string) => p.replace(/[\\/]+$/, "");

export function sharesContentPath(
  t: NormalizedTorrent,
  all: readonly NormalizedTorrent[],
): boolean {
  if (!t.contentPath) return false;
  const mine = normPath(t.contentPath);
  const hash = t.hash.toLowerCase();
  // Equal, or one inside the other at a path-segment boundary (a cross-seed inside a pack folder).
  const overlaps = (other: string) =>
    other === mine ||
    other.startsWith(`${mine}/`) ||
    mine.startsWith(`${other}/`);
  return all.some(
    (o) =>
      o.hash.toLowerCase() !== hash &&
      o.contentPath != null &&
      overlaps(normPath(o.contentPath)),
  );
}

/** download_history ids named by a torrent's rawkoon-dh-N tags. */
export function taggedRowIds(t: Pick<NormalizedTorrent, "labels">): number[] {
  return t.labels.flatMap((label) => {
    const m = label.trim().match(RAWKOON_TAG);
    return m ? [Number(m[1])] : [];
  });
}

export function classifyOrphans(
  torrents: readonly NormalizedTorrent[],
  ownedHashes: ReadonlySet<string>,
  // A live row can own a torrent through its tag when the stored hash differs (v2/hybrid).
  ownedRowIds: ReadonlySet<number> = new Set(),
): NormalizedTorrent[] {
  return torrents.filter(
    (t) =>
      isRawkoonOwned(t) &&
      !ownedHashes.has(t.hash.toLowerCase()) &&
      !taggedRowIds(t).some((id) => ownedRowIds.has(id)),
  );
}

export function normalizeExtension(raw: string): string | null {
  const ext = raw.trim().toLowerCase().replace(/^\.+/, "");
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : null;
}

export function findBlockedFile(
  files: readonly string[],
  extensions: readonly string[],
): string | null {
  if (extensions.length === 0) return null;
  const blocked = new Set(extensions.map((e) => e.toLowerCase()));
  for (const file of files) {
    const base = file.split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    if (dot === -1 || dot === base.length - 1) continue;
    if (blocked.has(base.slice(dot + 1).toLowerCase())) return file;
  }
  return null;
}

export function statsOf(t: NormalizedTorrent): SeedStats {
  return {
    ratio: t.ratio,
    seedingTimeSecs: t.seedingTimeSecs,
    upSpeed: t.upSpeed,
    sizeBytes: t.sizeBytes,
  };
}
