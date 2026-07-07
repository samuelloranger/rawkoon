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

export async function isSeasonPackGrabScope(
  mediaId: number,
  season: number,
  cache: Map<string, boolean> = new Map(),
): Promise<boolean> {
  const key = `wanted:${mediaId}:${season}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const nowMinusGrace = new Date(Date.now() - 60 * 60 * 1000);
  const cutoff = toUtcMidnightDate(
    localDateYmd(APP_DISPLAY_TIMEZONE, nowMinusGrace),
  );

  const totalMonitored = await prisma.libraryEpisode.count({
    where: { mediaId, season, monitored: true },
  });
  if (totalMonitored === 0) {
    cache.set(key, false);
    return false;
  }

  const inGrabSet = await prisma.libraryEpisode.count({
    where: {
      mediaId,
      season,
      monitored: true,
      status: "wanted",
      airDate: { lte: cutoff },
      files: { none: {} },
      // Match the auto_grab_stalled candidate query (this scope's only caller):
      // stalled = attempts at/over the warn threshold with no upper bound, so a
      // season with some cron-exhausted episodes still groups as one pack alert
      // instead of fragmenting into per-episode alerts.
      searchAttempts: { gte: LIBRARY_ATTENTION_WARN_ATTEMPTS },
    },
  });

  const ok = inGrabSet === totalMonitored;
  cache.set(key, ok);
  return ok;
}

/** All monitored episodes in the season are skipped (typical after a failed season-pack cron). */
export async function isSeasonPackSkippedScope(
  mediaId: number,
  season: number,
  cache: Map<string, boolean> = new Map(),
): Promise<boolean> {
  const key = `skip:${mediaId}:${season}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const totalMonitored = await prisma.libraryEpisode.count({
    where: { mediaId, season, monitored: true },
  });
  if (totalMonitored === 0) {
    cache.set(key, false);
    return false;
  }

  const skippedCount = await prisma.libraryEpisode.count({
    where: {
      mediaId,
      season,
      monitored: true,
      status: "skipped",
    },
  });

  const ok = skippedCount === totalMonitored;
  cache.set(key, ok);
  return ok;
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

  for (const [, group] of grouped) {
    const first = group[0];
    const pack =
      kind === "grab_skipped"
        ? await isSeasonPackSkippedScope(first.mediaId, first.season, packCache)
        : await isSeasonPackGrabScope(first.mediaId, first.season, packCache);
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
