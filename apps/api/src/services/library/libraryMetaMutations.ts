import { prisma } from "@rawkoon/api/db";
import { libraryMediaInclude } from "@rawkoon/api/routes/library/libraryHelpers";
import { upgradeFileSelect } from "@rawkoon/api/services/upgradeTargets";

export type LibraryStatusValue =
  | "wanted"
  | "downloading"
  | "downloaded"
  | "skipped";

export function updateLibraryStatus(id: number, status: LibraryStatusValue) {
  return prisma.libraryMedia.update({
    where: { id },
    data: {
      status,
      ...(status === "wanted" ? { searchAttempts: 0 } : {}),
    },
    include: libraryMediaInclude,
  });
}

export function updateLibraryMonitored(id: number, monitored: boolean) {
  return prisma.libraryMedia.update({
    where: { id },
    data: { monitored },
    include: libraryMediaInclude,
  });
}

export function findLibraryMedia(id: number) {
  return prisma.libraryMedia.findUnique({ where: { id } });
}

export function updateLibraryQualityProfile(
  id: number,
  qualityProfileId: number | null,
) {
  return prisma.libraryMedia.update({
    where: { id },
    data: { qualityProfileId },
    include: libraryMediaInclude,
  });
}

export function listMovieFilesForUpgradeCheck(mediaId: number) {
  return prisma.mediaFile.findMany({
    where: { mediaId, episodeId: null },
    select: upgradeFileSelect,
  });
}

export function findLibraryMediaForSearchTitle(id: number) {
  return prisma.libraryMedia.findUnique({
    where: { id },
    select: { id: true, tmdbId: true, type: true, title: true },
  });
}

export function updateLibrarySearchTitle(
  id: number,
  searchTitle: string,
  searchTitleLanguage: string,
) {
  return prisma.libraryMedia.update({
    where: { id },
    data: { searchTitle, searchTitleLanguage },
    include: libraryMediaInclude,
  });
}

export async function setSeasonMonitored(
  mediaId: number,
  season: number,
  monitored: boolean,
): Promise<number> {
  const result = await prisma.libraryEpisode.updateMany({
    where: { mediaId, season },
    data: { monitored },
  });
  return result.count;
}

export function setEpisodeMonitored(
  mediaId: number,
  episodeId: number,
  monitored: boolean,
) {
  return prisma.libraryEpisode.update({
    where: { id: episodeId, mediaId },
    data: { monitored },
  });
}

export function setEpisodeStatus(
  mediaId: number,
  episodeId: number,
  status: LibraryStatusValue,
) {
  return prisma.libraryEpisode.update({
    where: { id: episodeId, mediaId },
    data: {
      status,
      ...(status === "wanted" ? { searchAttempts: 0 } : {}),
    },
  });
}

export function findLibraryOverrides(id: number) {
  return prisma.libraryMedia.findUnique({
    where: { id },
    select: { overrides: true },
  });
}

export function updateLibraryOverrides(
  id: number,
  overrides: Record<string, unknown>,
) {
  return prisma.libraryMedia.update({
    where: { id },
    data: { overrides: overrides as object },
    include: libraryMediaInclude,
  });
}
