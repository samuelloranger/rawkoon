import { prisma } from "@rawkoon/api/db";
import { searchAndGrab } from "@rawkoon/api/services/mediaGrabberSearch";
import { MAX_CRON_GRAB_ATTEMPTS } from "@rawkoon/api/constants/libraryGrab";
import { notifyAdminsLibraryGrabSkipped } from "@rawkoon/api/workers/notifyLibraryGrabSkipped";
import {
  APP_DISPLAY_TIMEZONE,
  localDateYmd,
  toUtcMidnightDate,
} from "@rawkoon/shared/utils/date";

function episodeSearchQuery(
  showTitle: string,
  season: number,
  episode: number,
): string {
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");
  return `${showTitle} S${s}E${e}`;
}

function seasonPackSearchQuery(showTitle: string, season: number): string {
  const s = String(season).padStart(2, "0");
  return `${showTitle} S${s}`;
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

  for (const [key, groupEps] of seasonGroups) {
    const [mediaIdStr, seasonStr] = key.split(":");
    const mediaId = Number(mediaIdStr);
    const season = Number(seasonStr);

    const totalMonitored = await prisma.libraryEpisode.count({
      where: { mediaId, season, monitored: true },
    });

    if (groupEps.length === totalMonitored) {
      for (const ep of groupEps) packEligibleIds.add(ep.id);
    }
  }

  // Process season pack searches for eligible seasons.
  for (const [key, groupEps] of seasonGroups) {
    if (!groupEps.every((ep) => packEligibleIds.has(ep.id))) continue;

    const [mediaIdStr, seasonStr] = key.split(":");
    const mediaId = Number(mediaIdStr);
    const season = Number(seasonStr);
    const media = groupEps[0].media;

    try {
      const result = await searchAndGrab({
        mediaId,
        mediaType: "tv",
        searchQuery: seasonPackSearchQuery(media.title, season),
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
        await notifyAdminsLibraryGrabSkipped(
          `Season pack "${media.title}" S${season} — ${skippedEpisodes.length} episode(s) exceeded ${MAX_CRON_GRAB_ATTEMPTS} failed cron grab attempts (${result.reason}). Status set to skipped.`,
        );
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
      const result = await searchAndGrab({
        mediaId: ep.media.id,
        episodeId: ep.id,
        mediaType: "tv",
        searchQuery: episodeSearchQuery(ep.media.title, ep.season, ep.episode),
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
        await notifyAdminsLibraryGrabSkipped(
          `Episode "${ep.media.title}" S${ep.season}E${ep.episode} (${ep.id}) exceeded ${MAX_CRON_GRAB_ATTEMPTS} failed cron grab attempts (${result.reason}). Status set to skipped.`,
        );
      }
    } catch (e) {
      console.warn(`[checkEpisodeReleases] Failed for episode ${ep.id}:`, e);
    }
  }
}
