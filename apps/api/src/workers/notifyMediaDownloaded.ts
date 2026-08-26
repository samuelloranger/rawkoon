import { prisma } from "@rawkoon/api/db";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import { getAdminUserIds } from "@rawkoon/api/utils/admins";

function formatSeasonEpisode(season: number, episode: number): string {
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");
  return `S${s}E${e}`;
}

function showLabel(title: string, year: number | null): string {
  return year ? `${title} (${year})` : title;
}

export async function notifyAdminsMediaDownloaded(
  mediaId: number,
  episodeId?: number | null,
): Promise<void> {
  const media = await prisma.libraryMedia.findUnique({
    where: { id: mediaId },
    select: { title: true, year: true, type: true, posterUrl: true },
  });
  if (!media) return;

  const label = showLabel(media.title, media.year);
  const imageUrl = media.posterUrl ?? undefined;

  let title: string;
  let body: string;

  if (media.type === "show" && episodeId != null) {
    const episode = await prisma.libraryEpisode.findUnique({
      where: { id: episodeId },
      select: { season: true, episode: true, title: true },
    });

    if (episode) {
      const code = formatSeasonEpisode(episode.season, episode.episode);
      title = `${code} downloaded`;
      const episodeName =
        episode.title && !/^episode\s+\d+$/i.test(episode.title.trim())
          ? `"${episode.title}"`
          : null;
      body = episodeName
        ? `${label} — ${code} ${episodeName} is now in your library.`
        : `${label} — ${code} is now in your library.`;
    } else {
      title = "Show episode downloaded";
      body = `${label} is now in your library.`;
    }
  } else if (media.type === "show") {
    title = "Show downloaded";
    body = `${label} is now in your library.`;
  } else {
    title = "Movie downloaded";
    body = `${label} is now in your library.`;
  }

  const adminIds = await getAdminUserIds();

  for (const adminId of adminIds) {
    try {
      await createAndQueueNotification(
        adminId,
        title,
        body,
        "library_media_downloaded",
        `/library/${mediaId}`,
        undefined,
        imageUrl,
      );
    } catch (e) {
      console.warn(
        `[notifyAdminsMediaDownloaded] Failed for user ${adminId}:`,
        e,
      );
    }
  }
}
