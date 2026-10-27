import { prisma } from "@rawkoon/api/db";
import {
  episodeMapKey,
  resolveGrabEpisodeId,
} from "@rawkoon/api/services/grab/grabEpisodeResolver";
import {
  loadProfileWithFormats,
  profileToScoreInput,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import {
  addJob,
  QUEUE_NAMES,
  SCHEDULED_JOB_NAMES,
} from "@rawkoon/api/services/queueService";
import { downloadedEpisodesFailingProfile } from "@rawkoon/api/services/upgradeTargets";

export function findLibraryMediaRow(id: number) {
  return prisma.libraryMedia.findUnique({ where: { id } });
}

export function resetMovieForManualSearch(id: number) {
  return prisma.libraryMedia.update({
    where: { id },
    data: { searchAttempts: 0, status: "wanted" },
  });
}

export function findEpisodeOfMedia(mediaId: number, episodeId: number) {
  return prisma.libraryEpisode.findFirst({
    where: { id: episodeId, mediaId },
  });
}

export function resetEpisodeForManualSearch(episodeId: number) {
  return prisma.libraryEpisode.update({
    where: { id: episodeId },
    data: { searchAttempts: 0, status: "wanted" },
  });
}

export async function retrySkippedEpisodes(
  mediaId: number,
  season: number,
): Promise<number> {
  const result = await prisma.libraryEpisode.updateMany({
    where: { mediaId, season, status: "skipped" },
    data: { status: "wanted", searchAttempts: 0 },
  });
  return result.count;
}

export function countDownloadingEpisodes(mediaId: number, season: number) {
  return prisma.libraryEpisode.count({
    where: { mediaId, season, status: "downloading" },
  });
}

export function listWantedEpisodes(mediaId: number, season: number) {
  return prisma.libraryEpisode.findMany({
    where: { mediaId, season, status: "wanted" },
  });
}

/**
 * Reconciles the requested episode against the release's own SxxExx.
 * The interactive search panel tags every grab with a single episode
 * context, so grabbing a different episode's release from that panel
 * would mislink it and make the post-processor render every grab to
 * the same destination (later grabs then fail with EEXIST).
 * With no episode context, a single-episode release is linked from its
 * SxxExx so it isn't keyed as a season pack.
 */
export async function resolveShowGrabEpisode(
  mediaId: number,
  episodeId: number | undefined,
  releaseTitle: string,
): Promise<
  { ok: true; episodeId: number | undefined } | { ok: false; reason: string }
> {
  const [requested, allEpisodes] = await Promise.all([
    episodeId != null
      ? prisma.libraryEpisode.findFirst({
          where: { id: episodeId, mediaId },
          select: { id: true, season: true, episode: true },
        })
      : null,
    prisma.libraryEpisode.findMany({
      where: { mediaId },
      select: { id: true, season: true, episode: true },
    }),
  ]);
  // A provided episode id that no longer belongs to this item is a
  // stale context — reject rather than silently degrade to a
  // season-pack grab.
  if (episodeId != null && !requested) {
    return { ok: false, reason: "Episode not found for this library item" };
  }
  const resolved = resolveGrabEpisodeId({
    requested,
    releaseTitle,
    episodesBySeasonEpisode: new Map(
      allEpisodes.map((e) => [episodeMapKey(e.season, e.episode), e]),
    ),
  });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  return { ok: true, episodeId: resolved.episodeId ?? undefined };
}

export function findLibraryMediaForUpgrade(id: number) {
  return prisma.libraryMedia.findUnique({
    where: { id },
    select: { id: true, type: true, status: true, qualityProfileId: true },
  });
}

type UpgradeTarget = {
  id: number;
  type: string;
  qualityProfileId: number | null;
};

/** Marks the title (movie) or its failing episodes (show) as upgrading and queues one search per target; returns the count. */
export async function enqueueAutoUpgrade(
  media: UpgradeTarget,
): Promise<number> {
  const id = media.id;
  if (media.type === "movie") {
    await prisma.libraryMedia.update({
      where: { id },
      data: { status: "upgrading" },
    });
    await addJob(
      QUEUE_NAMES.SCHEDULED_TASKS,
      SCHEDULED_JOB_NAMES.UPGRADE_MEDIA_SEARCH,
      { mediaId: id, episodeId: null },
    );
    return 1;
  }
  // Only the episodes whose files fail the profile; without a profile
  // nothing can be judged, so every downloaded episode is searched.
  const profile =
    media.qualityProfileId != null
      ? await loadProfileWithFormats(media.qualityProfileId)
      : null;
  const episodes = profile
    ? (
        await downloadedEpisodesFailingProfile(id, profileToScoreInput(profile))
      ).map((epId) => ({ id: epId }))
    : await prisma.libraryEpisode.findMany({
        where: { mediaId: id, status: "downloaded" },
        select: { id: true },
      });

  await prisma.libraryEpisode.updateMany({
    where: { id: { in: episodes.map((ep) => ep.id) } },
    data: { status: "upgrading" },
  });

  await Promise.all(
    episodes.map((ep) =>
      addJob(
        QUEUE_NAMES.SCHEDULED_TASKS,
        SCHEDULED_JOB_NAMES.UPGRADE_MEDIA_SEARCH,
        { mediaId: id, episodeId: ep.id },
      ),
    ),
  );
  return episodes.length;
}
