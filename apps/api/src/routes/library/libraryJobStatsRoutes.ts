import { Elysia, t } from "elysia";

import { prisma } from "@rawkoon/api/db";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { serverError } from "@rawkoon/api/errors";
import { buildLibraryStatsResponse } from "./libraryStats";

/**
 * GET /api/library/stats
 * GET /api/library/language-tags
 * GET /api/library/download-history
 * GET /api/library/download-history/stats
 */
export const libraryJobStatsRoutes = new Elysia()
  .use(requireUser)
  .get("/stats", async ({ set }) => {
    try {
      const [typeStatusRows, tmdbStatusRows, files] = await Promise.all([
        prisma.libraryMedia.groupBy({
          by: ["type", "status"],
          _count: true,
        }),
        prisma.libraryMedia.groupBy({
          by: ["tmdbStatus"],
          where: { type: "show" },
          _count: true,
        }),
        prisma.$queryRaw<{ resolution: number | null; size_bytes: bigint }[]>`
          SELECT resolution, SUM(size_bytes) AS size_bytes
          FROM media_files
          GROUP BY resolution
        `,
      ]);

      const stats = buildLibraryStatsResponse({
        byTypeStatus: typeStatusRows.map((r) => ({
          type: r.type,
          status: r.status,
          count: r._count,
        })),
        byTmdbStatus: tmdbStatusRows.map((r) => ({
          tmdb_status: r.tmdbStatus,
          count: r._count,
        })),
        files: files.map((f) => ({
          resolution: f.resolution,
          size_bytes: f.size_bytes,
        })),
      });

      return { stats };
    } catch {
      return serverError(set, "Failed to fetch library stats");
    }
  })

  .get("/language-tags", async ({ set }) => {
    try {
      const rows = await prisma.$queryRaw<
        { tag: string }[]
      >`SELECT DISTINCT UNNEST(language_tags) AS tag FROM media_files`;
      const tags = rows.map((r) => r.tag).filter(Boolean);
      const order: Record<string, number> = {
        EN: 0,
        VFQ: 1,
        VFF: 2,
        VFI: 3,
        FR: 4,
      };
      tags.sort((a, b) => {
        const ai = order[a] ?? 100;
        const bi = order[b] ?? 100;
        if (ai !== bi) return ai - bi;
        return a.localeCompare(b);
      });
      return { tags };
    } catch {
      return serverError(set, "Failed to fetch language tags");
    }
  })

  .get(
    "/download-history",
    async ({ query, set }) => {
      try {
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
      } catch {
        return serverError(set, "Failed to fetch download history");
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.Number()),
        limit: t.Optional(t.Number()),
        status: t.Optional(
          t.Union([
            t.Literal("all"),
            t.Literal("completed"),
            t.Literal("failed"),
            t.Literal("active"),
          ]),
        ),
        days: t.Optional(t.Number()),
      }),
    },
  )

  .get("/download-history/stats", async ({ set }) => {
    try {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000);

      const [total, completed, failed, byIndexer, recentGrabs] =
        await Promise.all([
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
        stats: {
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
        },
      };
    } catch {
      return serverError(set, "Failed to fetch download history stats");
    }
  });
