import { prisma } from "@rawkoon/api/db";
import {
  formatSeason,
  formatSeasonEpisode,
  showLabel,
} from "@rawkoon/api/services/notification/notificationCopy";
import { getAdminNotificationTargets } from "@rawkoon/api/services/notification/notificationPreferences";
import {
  createAndQueueNotification,
  type CreateNotificationOptions,
} from "@rawkoon/api/workers/notificationService";

type MediaContext = {
  mediaId: number;
  title: string;
  year: number | null;
  type: "movie" | "show";
  posterUrl: string | null;
  label: string;
};

type EpisodeContext = {
  season: number;
  episode: number;
  title: string | null;
  code: string;
};

export async function loadMediaContext(
  mediaId: number,
): Promise<MediaContext | null> {
  const media = await prisma.libraryMedia.findUnique({
    where: { id: mediaId },
    select: { id: true, title: true, year: true, type: true, posterUrl: true },
  });
  if (!media) return null;
  return {
    mediaId: media.id,
    title: media.title,
    year: media.year,
    type: media.type as "movie" | "show",
    posterUrl: media.posterUrl,
    label: showLabel(media.title, media.year),
  };
}

export async function loadEpisodeContext(
  episodeId: number,
): Promise<EpisodeContext | null> {
  const episode = await prisma.libraryEpisode.findUnique({
    where: { id: episodeId },
    select: { season: true, episode: true, title: true },
  });
  if (!episode) return null;
  return {
    season: episode.season,
    episode: episode.episode,
    title: episode.title,
    code: formatSeasonEpisode(episode.season, episode.episode),
  };
}

export function seasonCode(season: number | null | undefined): string | null {
  return season != null ? formatSeason(season) : null;
}

/** Structured fields a client can lay out itself instead of parsing the localized title and body. */
export function subjectMetadata(
  media: MediaContext,
  opts: {
    code?: string | null;
    detail?: string | null;
    isUpgrade?: boolean;
  },
): Record<string, unknown> {
  return {
    media_id: media.mediaId,
    subject: media.title,
    ...(opts.code ? { code: opts.code } : {}),
    ...(opts.detail ? { detail: opts.detail } : {}),
    ...(opts.isUpgrade ? { is_upgrade: true } : {}),
  };
}

export async function notifyAdmins(
  build: (locale: string | null) => {
    title: string;
    body: string;
    type: string;
    url: string;
  },
  opts: {
    imageUrl?: string | null;
    metadata?: Record<string, unknown>;
    notifyOptions?: CreateNotificationOptions;
    logTag: string;
  },
): Promise<void> {
  const admins = await getAdminNotificationTargets();
  for (const admin of admins) {
    const msg = build(admin.locale);
    try {
      await createAndQueueNotification(
        admin.id,
        msg.title,
        msg.body,
        msg.type,
        msg.url,
        opts.metadata,
        opts.imageUrl ?? undefined,
        {
          ...opts.notifyOptions,
          skipPreferenceCheck: false,
        },
      );
    } catch (e) {
      console.warn(`[${opts.logTag}] Failed for user ${admin.id}:`, e);
    }
  }
}
