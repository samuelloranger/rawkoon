import { prisma } from "@rawkoon/api/db";

export type DownloadHistoryListQuery = {
  page?: number;
  limit?: number;
  status?: "all" | "completed" | "failed" | "active";
  days?: number;
};

export async function listDownloadHistory(query: DownloadHistoryListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 25));
  const { status, days } = query;

  const where: Record<string, unknown> = {};
  if (status === "completed") {
    Object.assign(where, { completedAt: { not: null }, failed: false });
  } else if (status === "failed") {
    where.failed = true;
  } else if (status === "active") {
    Object.assign(where, { completedAt: null, failed: false });
  }
  if (days && days > 0) {
    where.grabbedAt = {
      gte: new Date(Date.now() - days * 86_400_000),
    };
  }

  const [items, total] = await Promise.all([
    prisma.downloadHistory.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { grabbedAt: "desc" },
      include: {
        media: { select: { id: true, title: true, type: true } },
      },
    }),
    prisma.downloadHistory.count({ where }),
  ]);

  return {
    items: items.map((h) => ({
      id: h.id,
      release_title: h.releaseTitle,
      indexer: h.indexer,
      torrent_hash: h.torrentHash,
      grabbed_at: h.grabbedAt.toISOString(),
      completed_at: h.completedAt?.toISOString() ?? null,
      failed: h.failed,
      fail_reason: h.failReason,
      episode_id: h.episodeId,
      post_process_error: h.postProcessError,
      post_process_destination_path: h.postProcessDestinationPath,
      ai_picked: h.aiPicked,
      media_id: h.mediaId,
      media_title: h.media?.title ?? null,
      media_type: h.media?.type ?? null,
    })),
    total,
    page,
    limit,
    has_more: page * limit < total,
  };
}

export async function getDownloadHistoryStats() {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000);

  const [total, completed, failed, byIndexer, recentGrabs] = await Promise.all([
    prisma.downloadHistory.count(),
    prisma.downloadHistory.count({
      where: { completedAt: { not: null }, failed: false },
    }),
    prisma.downloadHistory.count({ where: { failed: true } }),
    prisma.downloadHistory.groupBy({
      by: ["indexer"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    prisma.downloadHistory.findMany({
      where: { grabbedAt: { gte: fourteenDaysAgo } },
      select: { grabbedAt: true },
    }),
  ]);

  const active = Math.max(0, total - completed - failed);
  const successRate =
    completed + failed > 0
      ? Math.round((completed / (completed + failed)) * 100)
      : null;

  const dayMap = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    dayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const g of recentGrabs) {
    const key = g.grabbedAt.toISOString().slice(0, 10);
    if (dayMap.has(key)) dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
  }

  return {
    total_grabs: total,
    completed_grabs: completed,
    failed_grabs: failed,
    active_grabs: active,
    success_rate: successRate,
    top_indexers: byIndexer.map((r) => ({
      name: r.indexer ?? "Unknown",
      count: r._count.id,
    })),
    grabs_by_day: Array.from(dayMap.entries()).map(([date, count]) => ({
      date,
      count,
    })),
  };
}
