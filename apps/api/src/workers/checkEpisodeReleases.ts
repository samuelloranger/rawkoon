import { prisma } from "@rawkoon/api/db";
import { searchLibraryTarget } from "@rawkoon/api/services/searchLibraryTarget";
import { activeShowGrabCovers } from "@rawkoon/api/services/activeShowGrab";
import { MAX_LIBRARY_GRAB_ATTEMPTS } from "@rawkoon/api/constants/libraryGrab";
import {
  isGrabSearchDue,
  recordEpisodeMiss,
  recordSeasonPackMiss,
} from "@rawkoon/api/services/grab/grabAttempts";
import {
  APP_DISPLAY_TIMEZONE,
  localDateYmd,
  toUtcMidnightDate,
} from "@rawkoon/shared/utils/date";

export async function checkEpisodeReleases(): Promise<void> {
  // airDate is a calendar day (Postgres DATE) meant to be read in the app's
  // display timezone — NY, not UTC. Episodes are eligible once NY local time
  // has passed that day's midnight, with a 60-min grace for indexers.
  const nowMinusGrace = new Date(Date.now() - 60 * 60 * 1000);
  const cutoff = toUtcMidnightDate(
    localDateYmd(APP_DISPLAY_TIMEZONE, nowMinusGrace),
  );

  const candidates = await prisma.libraryEpisode.findMany({
    where: {
      status: "wanted",
      monitored: true,
      airDate: { lte: cutoff },
      files: { none: {} },
      media: { type: "show", monitored: true },
      searchAttempts: { lt: MAX_LIBRARY_GRAB_ATTEMPTS },
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

  // Episodes stay "wanted" while a show-level pack carrying their season downloads or imports.
  const covers = await activeShowGrabCovers([
    ...new Set(candidates.map((ep) => ep.mediaId)),
  ]);
  const episodes = candidates.filter(
    (ep) => !covers.get(ep.mediaId)?.(ep.season),
  );

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

  for (const [key, groupEps] of seasonGroups) {
    if (!groupEps.every((ep) => packEligibleIds.has(ep.id))) continue;
    if (!groupEps.some((ep) => isGrabSearchDue(ep))) continue;

    const [mediaIdStr, seasonStr] = key.split(":");
    const mediaId = Number(mediaIdStr);
    const season = Number(seasonStr);
    const media = groupEps[0].media;

    try {
      // The scheduled episode checks never published outcomes; keep it so.
      const { result, countsAsMiss } = await searchLibraryTarget(
        media,
        { kind: "season", season },
        { trigger: "scheduled", publish: false },
      );

      if (!countsAsMiss || result.grabbed) continue;

      await recordSeasonPackMiss(mediaId, season, groupEps, result.reason);
    } catch (e) {
      console.warn(
        `[checkEpisodeReleases] Season pack failed for media ${mediaId} S${season}:`,
        e,
      );
    }
  }

  const individualEpisodes = episodes.filter(
    (ep) => !packEligibleIds.has(ep.id) && isGrabSearchDue(ep),
  );

  for (const ep of individualEpisodes) {
    try {
      const { result, countsAsMiss } = await searchLibraryTarget(
        ep.media,
        {
          kind: "episode",
          episodeId: ep.id,
          season: ep.season,
          episode: ep.episode,
        },
        { trigger: "scheduled", publish: false },
      );

      if (!countsAsMiss || result.grabbed) continue;

      await recordEpisodeMiss(
        { id: ep.id, mediaId: ep.media.id, searchAttempts: ep.searchAttempts },
        result.reason,
      );
    } catch (e) {
      console.warn(`[checkEpisodeReleases] Failed for episode ${ep.id}:`, e);
    }
  }
}
