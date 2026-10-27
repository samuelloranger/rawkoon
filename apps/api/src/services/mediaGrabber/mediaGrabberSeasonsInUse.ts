import { prisma } from "@rawkoon/api/db";
import { inFlightGrabWhere } from "@rawkoon/api/services/activeShowGrab";
import { parseReleaseSeasonSpan } from "@rawkoon/shared/utils/releaseStructure";

export type SeasonsInUse = { seasons: number[]; all: boolean };

/** Seasons already downloaded, grabbed or carried by a grab in flight; `all` when a series-wide pack is. */
export async function loadSeasonsInUse(mediaId: number): Promise<SeasonsInUse> {
  const [eps, grabs] = await Promise.all([
    prisma.libraryEpisode.findMany({
      where: { mediaId, season: { gt: 0 } },
      select: {
        season: true,
        status: true,
        _count: { select: { files: true } },
      },
    }),
    prisma.downloadHistory.findMany({
      where: { ...(await inFlightGrabWhere()), mediaId },
      select: {
        season: true,
        episodeId: true,
        releaseTitle: true,
        episode: { select: { season: true } },
      },
    }),
  ]);
  const seasons = eps
    .filter(
      (e) =>
        e._count.files > 0 ||
        ["downloaded", "downloading", "upgrading"].includes(e.status),
    )
    .map((e) => e.season);
  let all = false;
  for (const g of grabs) {
    const s = g.season ?? g.episode?.season;
    if (s != null) {
      seasons.push(s);
      continue;
    }
    const span = parseReleaseSeasonSpan(g.releaseTitle);
    if (!span) all = true;
    else for (let n = span.from; n <= span.to; n++) seasons.push(n);
  }
  return { seasons, all };
}
