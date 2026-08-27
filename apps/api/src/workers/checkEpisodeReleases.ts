import { prisma } from "@rawkoon/api/db";
import { searchAndGrabWithTitleFallback } from "@rawkoon/api/services/mediaGrabberSearch";
import { resolveSearchTitles } from "@rawkoon/api/utils/medias/resolveSearchTitles";
import { MAX_CRON_GRAB_ATTEMPTS } from "@rawkoon/api/constants/libraryGrab";
import { notifyAdminsLibraryGrabSkipped } from "@rawkoon/api/workers/notifyLibraryGrabSkipped";
import {
  APP_DISPLAY_TIMEZONE,
  localDateYmd,
  toUtcMidnightDate,
} from "@rawkoon/shared/utils/date";

function episodeSuffix(season: number, episode: number): string {
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");
  return ` S${s}E${e}`;
}

function seasonPackSuffix(season: number): string {
  const s = String(season).padStart(2, "0");
  return ` S${s}`;
}

export async function checkEpisodeReleases(): Promise<void> {
  // airDate is a calendar day (Postgres DATE) meant to be read in the app's
  // display timezone — NY, not UTC. Episodes are eligible once NY local time
  // has passed that day's midnight, with a 60-min grace for indexers.
  const nowMinusGrace = new Date(Date.now() - 60 * 60 * 1000);
  const cutoff = toUtcMidnightDate(
    localDateYmd(APP_DISPLAY_TIMEZONE, nowMinusGrace),
  );

  const episodes = await prisma.libraryEpisode.findMany({
    where: {
      status: "wanted",
      monitored: true,
      airDate: { lte: cutoff },
      files: { none: {} },
      media: { type: "show", monitored: true },
      searchAttempts: { lt: MAX_CRON_GRAB_ATTEMPTS },
    },
    include: {
      media: {
        select: {
          id: true,
          title: true,
          searchTitle: true,
          originalTitle: true,
          qualityProfileId: true,
        },
      },
    },
  });

  // Group episodes by mediaId:season to detect pack-eligible seasons.
  const seasonGroups = new Map<string, (typeof episodes)[number][]>();
  for (const ep of episodes) {
    const key = `${ep.mediaId}:${ep.season}`;
    const list = seasonGroups.get(key) ?? [];
    list.push(ep);
    seasonGroups.set(key, list);
  }

  // A season is pack-eligible when every monitored episode is in the
  // "wanted + aired + no files" set — i.e. nothing has been grabbed yet.
  const packEligibleIds = new Set<number>();

  if (seasonGroups.size > 0) {
    // One groupBy for every season in play, not one count per season.
    const monitoredCounts = await prisma.libraryEpisode.groupBy({
      by: ["mediaId", "season"],
      where: {
        OR: [...seasonGroups.values()].map((g) => ({
          mediaId: g[0].mediaId,
          season: g[0].season,
        })),
        monitored: true,
      },
      _count: { _all: true },
    });
    const totalBySeason = new Map(
      monitoredCounts.map((r) => [`${r.mediaId}:${r.season}`, r._count._all]),
    );

    for (const [key, groupEps] of seasonGroups) {
      if (groupEps.length === (totalBySeason.get(key) ?? 0)) {
        for (const ep of groupEps) packEligibleIds.add(ep.id);
      }
    }
  }

  // Process season pack searches for eligible seasons.
  for (const [key, groupEps] of seasonGroups) {
    if (!groupEps.every((ep) => packEligibleIds.has(ep.id))) continue;

    const [mediaIdStr, seasonStr] = key.split(":");
    const mediaId = Number(mediaIdStr);
    const season = Number(seasonStr);
    const media = groupEps[0].media;
    const { queries } = resolveSearchTitles({
      title: media.title,
      searchTitle: media.searchTitle,
      originalTitle: media.originalTitle,
    });

    try {
      const result = await searchAndGrabWithTitleFallback({
        mediaId,
        season,
        mediaType: "tv",
        titleBaseQueries: queries,
        suffix: seasonPackSuffix(season),
        qualityProfileId: media.qualityProfileId,
      });

      if (result.grabbed) continue;

      // Increment searchAttempts on all episodes in the pack; skip those at cap.
      const skippedEpisodes: typeof groupEps = [];
      for (const ep of groupEps) {
        const next = ep.searchAttempts + 1;
        const reachedCap = next >= MAX_CRON_GRAB_ATTEMPTS;
        await prisma.libraryEpisode.update({
          where: { id: ep.id },
          data: {
            searchAttempts: next,
            ...(reachedCap ? { status: "skipped" } : {}),
          },
        });
        if (reachedCap) skippedEpisodes.push(ep);
      }

      if (skippedEpisodes.length > 0) {
        await notifyAdminsLibraryGrabSkipped({
          mediaId,
          season,
          reason: `No matching release after ${MAX_CRON_GRAB_ATTEMPTS} attempts (${result.reason})`,
          scope: "season_pack",
        });
      }
    } catch (e) {
      console.warn(
        `[checkEpisodeReleases] Season pack failed for media ${mediaId} S${season}:`,
        e,
      );
    }
  }

  // Process individual episode searches for non-pack-eligible episodes.
  const individualEpisodes = episodes.filter(
    (ep) => !packEligibleIds.has(ep.id),
  );

  for (const ep of individualEpisodes) {
    try {
      const { queries } = resolveSearchTitles({
        title: ep.media.title,
        searchTitle: ep.media.searchTitle,
        originalTitle: ep.media.originalTitle,
      });
      const result = await searchAndGrabWithTitleFallback({
        mediaId: ep.media.id,
        episodeId: ep.id,
        mediaType: "tv",
        titleBaseQueries: queries,
        suffix: episodeSuffix(ep.season, ep.episode),
        qualityProfileId: ep.media.qualityProfileId,
      });

      if (result.grabbed) continue;

      const next = ep.searchAttempts + 1;
      const reachedCap = next >= MAX_CRON_GRAB_ATTEMPTS;
      await prisma.libraryEpisode.update({
        where: { id: ep.id },
        data: {
          searchAttempts: next,
          ...(reachedCap ? { status: "skipped" } : {}),
        },
      });

      if (reachedCap) {
        await notifyAdminsLibraryGrabSkipped({
          mediaId: ep.media.id,
          episodeId: ep.id,
          reason: `No matching release after ${MAX_CRON_GRAB_ATTEMPTS} attempts (${result.reason})`,
          scope: "episode",
        });
      }
    } catch (e) {
      console.warn(`[checkEpisodeReleases] Failed for episode ${ep.id}:`, e);
    }
  }
}
