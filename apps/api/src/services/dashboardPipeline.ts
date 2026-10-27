import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { estimateEtaSeconds } from "@rawkoon/api/services/downloadClient/eta";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  loadActiveBookGrabRows,
  loadActiveGrabRows,
  type ActiveBookGrabRow,
  type ActiveGrabRow,
} from "@rawkoon/api/services/downloads/activeDownloads";
import {
  countOpenLibraryAttention,
  listOpenLibraryAttentionForApi,
} from "@rawkoon/api/services/libraryAttention/libraryAttentionApi";
import { getNextRssRunAt } from "@rawkoon/api/services/rss/rssNextRun";
import { getLastRssRun } from "@rawkoon/api/services/rss/rssRunStatus";
import type {
  DashboardPipeline,
  DashboardPipelineDownloadItem,
} from "@rawkoon/shared/types";

const MAX_ITEMS = 3;

export interface PipelineSources {
  listTorrents: () => Promise<NormalizedTorrent[] | null>;
  loadMediaRows: () => Promise<ActiveGrabRow[]>;
  loadBookRows: () => Promise<ActiveBookGrabRow[]>;
  countDelayedTargets: () => Promise<number>;
  countOpenAlerts: () => Promise<number>;
  openAlertMediaIds: () => Promise<number[]>;
  countWantedMisses: (excludeMediaIds: number[]) => Promise<number>;
  lastRssRun: typeof getLastRssRun;
  nextRssRunAt: () => Promise<string>;
  countReencode: () => Promise<{ running: number; queued: number }>;
}

export const defaultPipelineSources: PipelineSources = {
  listTorrents: async () => {
    const active = await resolveActiveAdapter();
    return active ? active.adapter.listTorrents() : null;
  },
  loadMediaRows: loadActiveGrabRows,
  loadBookRows: loadActiveBookGrabRows,
  countDelayedTargets: async () =>
    (await prisma.pendingRelease.groupBy({ by: ["targetKey"] })).length,
  countOpenAlerts: countOpenLibraryAttention,
  openAlertMediaIds: async () => {
    const { items } = await listOpenLibraryAttentionForApi();
    return items.map((i) => i.media_id);
  },
  // Same rule as the iOS Needs-attention card: a wanted title whose last search ended in no match or an error.
  countWantedMisses: (excludeMediaIds) =>
    prisma.libraryMedia.count({
      where: {
        status: "wanted",
        lastSearchOutcome: { in: ["no_match", "error"] },
        id: { notIn: excludeMediaIds },
      },
    }),
  lastRssRun: getLastRssRun,
  nextRssRunAt: getNextRssRunAt,
  // Plain counts: buildSummary also purges history, which a polled GET must not do.
  countReencode: async () => {
    const [running, queued] = await Promise.all([
      prisma.transcodeJob.count({ where: { status: "running" } }),
      prisma.transcodeJob.count({ where: { status: "queued" } }),
    ]);
    return { running, queued };
  },
};

async function settle<T>(
  label: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    console.error(`[dashboard/pipeline] ${label}`, error);
    return fallback;
  }
}

async function readDownloading(
  s: PipelineSources,
): Promise<DashboardPipeline["downloading"]> {
  const torrents = await s.listTorrents();
  if (!torrents)
    return { available: true, count: 0, speed_bytes_per_sec: 0, items: [] };
  const [mediaRows, bookRows] = await Promise.all([
    s.loadMediaRows(),
    s.loadBookRows(),
  ]);
  const byHash = new Map(torrents.map((t) => [t.hash.toLowerCase(), t]));
  const items: DashboardPipelineDownloadItem[] = [];
  for (const row of mediaRows) {
    const t = row.torrentHash && byHash.get(row.torrentHash.toLowerCase());
    if (!t || !row.media) continue;
    items.push({
      id: row.id,
      library_media_id: row.media.id,
      book_id: null,
      title: row.media.title,
      progress: t.progress,
      eta_seconds: estimateEtaSeconds(t),
    });
  }
  for (const row of bookRows) {
    const t = row.torrentHash && byHash.get(row.torrentHash.toLowerCase());
    if (!t || !row.bookEdition) continue;
    items.push({
      id: row.id,
      library_media_id: null,
      book_id: row.bookEdition.book.id,
      title: row.bookEdition.book.title,
      progress: t.progress,
      eta_seconds: estimateEtaSeconds(t),
    });
  }
  items.sort((a, b) => a.id - b.id);
  return {
    available: true,
    count: items.length,
    speed_bytes_per_sec: torrents.reduce(
      (total, t) => total + Math.max(0, t.dlSpeed),
      0,
    ),
    items: items.slice(0, MAX_ITEMS),
  };
}

async function readAttention(
  s: PipelineSources,
): Promise<DashboardPipeline["attention"]> {
  const [alerts, mediaIds] = await Promise.all([
    s.countOpenAlerts(),
    // A failed id list only loses the duplicate exclusion, not the whole block.
    settle("attention.alert_ids", s.openAlertMediaIds, [] as number[]),
  ]);
  const gaveUp = await s.countWantedMisses(mediaIds);
  return { available: true, count: alerts + gaveUp, alerts, gave_up: gaveUp };
}

async function readRss(s: PipelineSources): Promise<DashboardPipeline["rss"]> {
  const [last, next] = await Promise.all([
    s.lastRssRun(),
    settle("rss.next_run", s.nextRssRunAt, null),
  ]);
  return {
    available: true,
    last_run_at: last?.completed_at ?? null,
    ok: last ? last.status === "success" : null,
    releases_found: last?.releases_found ?? null,
    next_run_at: next,
  };
}

/** One failing source marks its own block unavailable and is logged; the rest still answer. */
export async function buildDashboardPipeline(
  s: PipelineSources = defaultPipelineSources,
): Promise<DashboardPipeline> {
  const [downloading, delayed, attention, rss, reencode] = await Promise.all([
    settle("downloading", () => readDownloading(s), {
      available: false,
      count: 0,
      speed_bytes_per_sec: 0,
      items: [],
    }),
    settle(
      "delayed",
      async () => ({ available: true, count: await s.countDelayedTargets() }),
      { available: false, count: 0 },
    ),
    settle("attention", () => readAttention(s), {
      available: false,
      count: 0,
      alerts: 0,
      gave_up: 0,
    }),
    settle("rss", () => readRss(s), {
      available: false,
      last_run_at: null,
      ok: null,
      releases_found: null,
      next_run_at: null,
    }),
    settle(
      "reencode",
      async () => {
        const r = await s.countReencode();
        return { available: true, active: r.running, queued: r.queued };
      },
      { available: false, active: 0, queued: 0 },
    ),
  ]);
  return { downloading, delayed, attention, rss, reencode };
}
