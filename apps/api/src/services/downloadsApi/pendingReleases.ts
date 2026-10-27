import { prisma } from "@rawkoon/api/db";
import type { PendingReleaseItem } from "@rawkoon/shared/types";

export async function listPendingReleaseItems(): Promise<PendingReleaseItem[]> {
  const rows = await prisma.pendingRelease.findMany({
    orderBy: [{ grabAfter: "asc" }, { score: "desc" }],
    include: { media: { select: { title: true, posterUrl: true } } },
  });
  const episodeIds = [
    ...new Set(rows.flatMap((r) => (r.episodeId == null ? [] : [r.episodeId]))),
  ];
  const episodes = episodeIds.length
    ? await prisma.libraryEpisode.findMany({
        where: { id: { in: episodeIds } },
        select: { id: true, season: true, episode: true },
      })
    : [];
  const episodeById = new Map(episodes.map((e) => [e.id, e]));

  const byTarget = new Map<string, PendingReleaseItem>();
  for (const r of rows) {
    const existing = byTarget.get(r.targetKey);
    if (existing) {
      existing.candidate_count++;
      continue;
    }
    const ep = r.episodeId != null ? episodeById.get(r.episodeId) : null;
    byTarget.set(r.targetKey, {
      target_key: r.targetKey,
      media_id: r.mediaId,
      media_title: r.media.title,
      poster_url: r.media.posterUrl,
      season: ep?.season ?? r.season,
      episode: ep?.episode ?? null,
      release_title: r.releaseTitle,
      candidate_count: 1,
      grab_after: r.grabAfter.toISOString(),
    });
  }
  const bestScore = new Map<string, number>();
  for (const r of rows) {
    const item = byTarget.get(r.targetKey)!;
    if (r.score > (bestScore.get(r.targetKey) ?? -Infinity)) {
      bestScore.set(r.targetKey, r.score);
      item.release_title = r.releaseTitle;
    }
  }
  return [...byTarget.values()];
}

/** Pulls the hold window forward; returns how many candidates matched. */
export async function releaseHeldTarget(targetKey: string): Promise<number> {
  const moved = await prisma.pendingRelease.updateMany({
    where: { targetKey },
    data: { grabAfter: new Date() },
  });
  return moved.count;
}
