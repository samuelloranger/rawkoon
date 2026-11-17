import { prisma } from "@rawkoon/api/db";
import { searchLibraryTarget } from "@rawkoon/api/services/searchLibraryTarget";
import type { LibraryTarget } from "@rawkoon/api/services/searchLibraryTarget";

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

  // Year is deliberately not selected: upgrade searches never carried one.
  let target: LibraryTarget =
    media.type === "movie" ? { kind: "movie" } : { kind: "show" };

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

    target = {
      kind: "episode",
      episodeId,
      season: ep.season,
      episode: ep.episode,
    };
  }

  const { result } = await searchLibraryTarget(
    { ...media, id: mediaId },
    target,
    { trigger: "upgrade", isUpgrade: true, publish: false },
  );

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
