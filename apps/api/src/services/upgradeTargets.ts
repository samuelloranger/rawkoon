import { prisma } from "@rawkoon/api/db";
import { filesFailProfile } from "@rawkoon/api/services/upgradeDetection";
import type { QualityProfileScoreInput } from "@rawkoon/api/utils/medias/releaseScorer";

export const upgradeFileSelect = {
  episodeId: true,
  resolution: true,
  source: true,
  videoCodec: true,
  hdrFormat: true,
  sizeBytes: true,
  languageTags: true,
  releaseGroup: true,
} as const;

/** Downloaded episodes of a show whose files no longer meet the profile. */
export async function downloadedEpisodesFailingProfile(
  mediaId: number,
  profile: QualityProfileScoreInput,
): Promise<number[]> {
  const episodes = await prisma.libraryEpisode.findMany({
    where: { mediaId, status: "downloaded" },
    select: { id: true },
  });
  if (episodes.length === 0) return [];

  const files = await prisma.mediaFile.findMany({
    where: { episodeId: { in: episodes.map((ep) => ep.id) } },
    select: upgradeFileSelect,
  });
  const byEpisode = new Map<number, typeof files>();
  for (const f of files) {
    if (f.episodeId == null) continue;
    const bucket = byEpisode.get(f.episodeId) ?? [];
    bucket.push(f);
    byEpisode.set(f.episodeId, bucket);
  }

  return episodes
    .filter((ep) => filesFailProfile(byEpisode.get(ep.id) ?? [], profile))
    .map((ep) => ep.id);
}
