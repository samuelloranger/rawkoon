import { getJsonCache } from "@rawkoon/api/services/cache";
import { getLastRssRun } from "@rawkoon/api/services/rssRunStatus";
import { TMDB_UPCOMING_CACHE_KEY } from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import type { DashboardUpcomingItem } from "@rawkoon/api/types/dashboardUpcoming";

export type LabbySummaryDeps = {
  getUpcoming: () => Promise<
    Array<{
      id: string;
      title: string;
      date: string | null;
      posterUrl?: string;
    }>
  >;
  getLastRssRun: typeof getLastRssRun;
};

async function getUpcoming() {
  const region = await getGlobalTmdbRegion();
  const cached = await getJsonCache<{ items?: DashboardUpcomingItem[] }>(
    `${TMDB_UPCOMING_CACHE_KEY}:${region}`,
  );
  return (cached?.items ?? []).slice(0, 8).map((item) => ({
    id: item.id,
    title: item.title,
    date: item.release_date,
    posterUrl: item.poster_url ?? undefined,
  }));
}

export async function buildLabbySummary(
  deps: LabbySummaryDeps = {
    getUpcoming,
    getLastRssRun,
  },
) {
  const [upcoming, rss] = await Promise.all([
    deps.getUpcoming(),
    deps.getLastRssRun(),
  ]);

  return {
    upcoming,
    rss: {
      status: rss?.status === "success" ? "ok" : (rss?.status ?? "unknown"),
      releasesFound: rss?.releases_found ?? null,
      releasesGrabbed: rss?.releases_grabbed ?? null,
      nextRunAt: null,
    },
  };
}
