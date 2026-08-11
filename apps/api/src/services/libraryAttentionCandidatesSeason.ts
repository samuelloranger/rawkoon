import { prisma } from "@rawkoon/api/db";
import { LIBRARY_ATTENTION_WARN_ATTEMPTS } from "@rawkoon/api/constants/libraryGrab";
import {
  APP_DISPLAY_TIMEZONE,
  localDateYmd,
  toUtcMidnightDate,
} from "@rawkoon/shared/utils/date";
import type { AttentionCandidate } from "@rawkoon/api/services/libraryAttentionTypes";

/** Parse season from typical release names (season pack or season folder style). */
export function inferSeasonFromReleaseTitle(title: string): number | null {
  const t = title.trim();
  if (!t) return null;
  const mPack = t.match(/\bS(?:eason)?[\s._-]*(\d{1,2})\b/i);
  if (mPack) return parseInt(mPack[1], 10);
  const mDot = t.match(/(?:^|[._\s-])S(\d{2})(?:E\d{2}|(?=[._\s-]|$))/i);
  if (mDot) return parseInt(mDot[1], 10);
  return null;
}

type SeasonKey = { mediaId: number; season: number };

/** Extra predicate that the whole monitored season must satisfy to group as a pack. */
function packMemberFilter(kind: "grab_skipped" | "auto_grab_stalled") {
  if (kind === "grab_skipped") return { status: "skipped" };

  const nowMinusGrace = new Date(Date.now() - 60 * 60 * 1000);
  const cutoff = toUtcMidnightDate(
    localDateYmd(APP_DISPLAY_TIMEZONE, nowMinusGrace),
  );
  return {
    status: "wanted",
    airDate: { lte: cutoff },
    files: { none: {} },
    // Match the auto_grab_stalled candidate query (this scope's only caller):
    // stalled = attempts at/over the warn threshold with no upper bound, so a
    // season with some cron-exhausted episodes still groups as one pack alert
    // instead of fragmenting into per-episode alerts.
    searchAttempts: { gte: LIBRARY_ATTENTION_WARN_ATTEMPTS },
  };
}

/**
 * A season is "pack scope" when every monitored episode in it matches the
 * kind's predicate. Resolved for all seasons at once: two groupBy queries
 * total, instead of two counts per season.
 */
export async function resolveSeasonPackScopes(
  seasons: SeasonKey[],
  kind: "grab_skipped" | "auto_grab_stalled",
  cache: Map<string, boolean> = new Map(),
): Promise<Map<string, boolean>> {
  const prefix = kind === "grab_skipped" ? "skip" : "wanted";
  const pending = seasons.filter(
    (s) => cache.get(`${prefix}:${s.mediaId}:${s.season}`) === undefined,
  );
  if (pending.length === 0) return cache;

  const scope = {
    OR: pending.map((s) => ({ mediaId: s.mediaId, season: s.season })),
  };
  const [totals, matching] = await Promise.all([
    prisma.libraryEpisode.groupBy({
      by: ["mediaId", "season"],
      where: { ...scope, monitored: true },
      _count: { _all: true },
    }),
    prisma.libraryEpisode.groupBy({
      by: ["mediaId", "season"],
      where: { ...scope, monitored: true, ...packMemberFilter(kind) },
      _count: { _all: true },
    }),
  ]);

  const matchedCounts = new Map(
    matching.map((r) => [`${r.mediaId}:${r.season}`, r._count._all]),
  );
  const totalCounts = new Map(
    totals.map((r) => [`${r.mediaId}:${r.season}`, r._count._all]),
  );

  for (const s of pending) {
    const pair = `${s.mediaId}:${s.season}`;
    const total = totalCounts.get(pair) ?? 0;
    // No monitored episodes → never a pack (matches the old count === 0 guard).
    const ok = total > 0 && (matchedCounts.get(pair) ?? 0) === total;
    cache.set(`${prefix}:${pair}`, ok);
  }

  return cache;
}

export async function pushEpisodePackOrIndividuals(
  episodes: Array<{
    id: number;
    mediaId: number;
    season: number;
    episode: number;
    searchAttempts: number;
    status: string;
    media: { id: number; title: string; type: string; status: string };
  }>,
  kind: "grab_skipped" | "auto_grab_stalled",
  packCache: Map<string, boolean>,
  out: AttentionCandidate[],
): Promise<void> {
  const grouped = new Map<string, typeof episodes>();
  for (const ep of episodes) {
    const k = `${ep.mediaId}:${ep.season}`;
    const arr = grouped.get(k) ?? [];
    arr.push(ep);
    grouped.set(k, arr);
  }

  const consumed = new Set<number>();

  // One batched resolution for every season in play, before the loop.
  await resolveSeasonPackScopes(
    [...grouped.values()].map((g) => ({
      mediaId: g[0].mediaId,
      season: g[0].season,
    })),
    kind,
    packCache,
  );
  const prefix = kind === "grab_skipped" ? "skip" : "wanted";

  for (const [, group] of grouped) {
    const first = group[0];
    const pack =
      packCache.get(`${prefix}:${first.mediaId}:${first.season}`) ?? false;
    if (pack && group.length > 0) {
      const maxAttempts = Math.max(...group.map((e) => e.searchAttempts));
      out.push({
        media_id: first.media.id,
        media_title: first.media.title,
        media_type: "show",
        scope_type: "season_pack",
        episode_id: null,
        season: first.season,
        episode_number: null,
        kind,
        detail: null,
        search_attempts: maxAttempts,
        library_status: kind === "grab_skipped" ? "skipped" : "wanted",
        download_history_id: null,
        grabbed_at: null,
      });
      for (const e of group) consumed.add(e.id);
    }
  }

  for (const ep of episodes) {
    if (consumed.has(ep.id)) continue;
    out.push({
      media_id: ep.media.id,
      media_title: ep.media.title,
      media_type: "show",
      scope_type: "episode",
      episode_id: ep.id,
      season: ep.season,
      episode_number: ep.episode,
      kind,
      detail: null,
      search_attempts: ep.searchAttempts,
      library_status: ep.status,
      download_history_id: null,
      grabbed_at: null,
    });
  }
}
