import { prisma } from "@rawkoon/api/db";
import { searchAndGrabWithTitleFallback } from "@rawkoon/api/services/mediaGrabberSearch";
import { resolveSearchTitles } from "@rawkoon/api/utils/medias/resolveSearchTitles";

export async function upgradeMediaSearch({
  mediaId,
  episodeId,
}: {
  mediaId: number;
  episodeId?: number | null;
}): Promise<void> {
  const media = await prisma.libraryMedia.findUnique({
    where: { id: mediaId },
    select: {
      title: true,
      searchTitle: true,
      originalTitle: true,
      type: true,
      qualityProfileId: true,
    },
  });

  if (!media) {
    console.warn(`[upgradeMediaSearch] LibraryMedia ${mediaId} not found`);
    return;
  }

  const mediaType = media.type === "movie" ? "movie" : "tv";
  const { queries } = resolveSearchTitles({
    title: media.title,
    searchTitle: media.searchTitle,
    originalTitle: media.originalTitle,
  });
  let suffix = "";

  if (episodeId != null) {
    const ep = await prisma.libraryEpisode.findUnique({
      where: { id: episodeId },
      select: { season: true, episode: true },
    });

    if (!ep) {
      console.warn(
        `[upgradeMediaSearch] LibraryEpisode ${episodeId} not found`,
      );
      return;
    }

    const season = String(ep.season).padStart(2, "0");
    const episode = String(ep.episode).padStart(2, "0");
    suffix = ` S${season}E${episode}`;
  }

  const result = await searchAndGrabWithTitleFallback({
    mediaId,
    episodeId: episodeId ?? undefined,
    mediaType,
    titleBaseQueries: queries,
    suffix,
    qualityProfileId: media.qualityProfileId,
    isUpgrade: true,
  });

  if (!result.grabbed) {
    console.warn(
      `[upgradeMediaSearch] No upgrade found for media ${mediaId}:`,
      result.reason,
    );

    if (episodeId != null) {
      await prisma.libraryEpisode.update({
        where: { id: episodeId },
        data: { status: "downloaded" },
      });
    } else {
      await prisma.libraryMedia.update({
        where: { id: mediaId },
        data: { status: "downloaded" },
      });
    }
  }
}
