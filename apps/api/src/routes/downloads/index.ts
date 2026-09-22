import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import {
  badRequest,
  notFound,
  ok,
  serverError,
  serviceUnavailable,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV, queryV } from "@rawkoon/api/middleware/validate";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import { listKnownIndexers } from "@rawkoon/api/services/seeding/indexerPrivacy";
import {
  loadOwnedHashes,
  removeOrphanTorrents,
} from "@rawkoon/api/services/seeding/orphans";
import { indexerKey } from "@rawkoon/api/services/seeding/seedPolicy";
import {
  defaultSweepDeps,
  loadSeedContext,
  planSeedReleases,
  releaseTorrentNow,
} from "@rawkoon/api/services/seeding/seedSweep";
import {
  buildOrphans,
  buildSeedRuleRows,
  buildSeedingTorrents,
  supersededIds,
} from "@rawkoon/api/services/seeding/seedingView";
import type { ReleasedTorrent, SeedReleaseReason } from "@rawkoon/shared/types";

const RELEASE_REASONS_SHOWN: SeedReleaseReason[] = [
  "target_met",
  "manual",
  "move_mode",
];

async function listClientTorrents(): Promise<NormalizedTorrent[] | null> {
  const active = await resolveActiveAdapter();
  if (!active) return [];
  return active.adapter.listTorrents().catch(() => null);
}

const hashParam = z.object({ hash: z.string().regex(/^[0-9a-fA-F]{40}$/) });
const indexerParam = z.object({ indexer: z.string().min(1).max(200) });
const ruleBody = z.object({
  ratio: z.number().min(0).max(100).nullable(),
  seed_time_mins: z.number().int().min(0).max(525_600).nullable(),
});

// Mounted at /api/downloads. Every route guards itself: a .use('*') guard leaks across .route() merges.
export const downloadsRoutes = new Hono<Env>()
  .get(
    "/seeding",
    requireAdmin,
    queryV(z.object({ preview: z.string().optional() })),
    async (c) => {
      try {
        const torrents = await listClientTorrents();
        if (torrents === null)
          return serviceUnavailable("Download client is unreachable");
        const [enabled, ctx, rows] = await Promise.all([
          defaultSweepDeps.isEnabled(),
          loadSeedContext(),
          prisma.downloadHistory.findMany({
            where: {
              completedAt: { not: null },
              failed: false,
              seedReleasedAt: null,
              torrentHash: { not: null },
            },
            select: {
              id: true,
              torrentHash: true,
              indexer: true,
              grabbedAt: true,
              mediaId: true,
              episodeId: true,
              bookEditionId: true,
              media: {
                select: {
                  id: true,
                  title: true,
                  year: true,
                  posterUrl: true,
                  type: true,
                },
              },
              bookEdition: {
                select: {
                  kind: true,
                  book: { select: { id: true, title: true, coverUrl: true } },
                },
              },
            },
          }),
        ]);
        const held = rows.flatMap((r) =>
          r.torrentHash
            ? [
                {
                  id: r.id,
                  torrentHash: r.torrentHash,
                  indexer: r.indexer,
                  grabbedAt: r.grabbedAt,
                  mediaId: r.mediaId,
                  episodeId: r.episodeId,
                  bookEditionId: r.bookEditionId,
                  media: r.media,
                  book: r.bookEdition
                    ? { ...r.bookEdition.book, kind: r.bookEdition.kind }
                    : null,
                },
              ]
            : [],
        );
        const mediaIds = [
          ...new Set(
            held.flatMap((h) => (h.mediaId != null ? [h.mediaId] : [])),
          ),
        ];
        const editionIds = [
          ...new Set(
            held.flatMap((h) =>
              h.bookEditionId != null ? [h.bookEditionId] : [],
            ),
          ),
        ];
        const completed = await prisma.downloadHistory.findMany({
          where: {
            completedAt: { not: null },
            failed: false,
            OR: [
              { mediaId: { in: mediaIds } },
              { bookEditionId: { in: editionIds } },
            ],
          },
          select: {
            id: true,
            mediaId: true,
            episodeId: true,
            bookEditionId: true,
            grabbedAt: true,
          },
        });
        const torrentsView = buildSeedingTorrents(
          held,
          torrents,
          ctx,
          supersededIds(held, completed),
        );

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const releasedRows = await prisma.downloadHistory.findMany({
          where: {
            seedReleasedAt: { gte: startOfDay },
            seedReleaseReason: { in: RELEASE_REASONS_SHOWN },
          },
          select: {
            torrentHash: true,
            releaseTitle: true,
            seedReleaseReason: true,
            seedReleasedAt: true,
            seedReleasedBytes: true,
            media: { select: { title: true } },
            bookEdition: { select: { book: { select: { title: true } } } },
          },
          orderBy: { seedReleasedAt: "desc" },
        });
        const releasedByHash = new Map<string, ReleasedTorrent>();
        for (const r of releasedRows) {
          const hash = r.torrentHash?.toLowerCase();
          if (!hash || releasedByHash.has(hash) || !r.seedReleasedAt) continue;
          releasedByHash.set(hash, {
            hash,
            title:
              r.media?.title ?? r.bookEdition?.book.title ?? r.releaseTitle,
            reason: r.seedReleaseReason as SeedReleaseReason,
            released_at: r.seedReleasedAt.toISOString(),
            size_bytes:
              r.seedReleasedBytes != null ? Number(r.seedReleasedBytes) : null,
          });
        }

        let wouldReleaseNow: { count: number; bytes: number } | undefined;
        if (c.req.valid("query").preview === "1") {
          const pendingHashes = await defaultSweepDeps.loadPendingHashes();
          const plan = planSeedReleases(
            held.map((h) => ({
              id: h.id,
              torrentHash: h.torrentHash,
              indexer: h.indexer,
            })),
            torrents,
            { ...ctx, pendingHashes },
          );
          const releases = plan.filter((d) => d.action === "release");
          wouldReleaseNow = {
            count: releases.length,
            bytes: releases.reduce(
              (sum, d) =>
                sum + (d.action === "release" ? d.torrent.sizeBytes : 0),
              0,
            ),
          };
        }

        return ok({
          enabled,
          torrents: torrentsView,
          released_today: [...releasedByHash.values()],
          ...(wouldReleaseNow ? { would_release_now: wouldReleaseNow } : {}),
        });
      } catch (e) {
        console.error("[downloads] seeding list failed:", e);
        return serverError("Failed to load seeding torrents");
      }
    },
  )
  .post(
    "/seeding/:hash/release",
    requireAdmin,
    paramV(hashParam),
    async (c) => {
      try {
        const result = await releaseTorrentNow(c.req.valid("param").hash);
        switch (result.status) {
          case "released":
            return ok({ released: true, freed_bytes: result.freedBytes });
          case "pending":
            return badRequest("Torrent is still downloading");
          case "adopted":
            return badRequest(
              "Rawkoon did not add this torrent; remove it in your download client",
            );
          case "unavailable":
            return serviceUnavailable(
              "Download client is not configured or unreachable",
            );
          default:
            return notFound("No seeding torrent with that hash");
        }
      } catch (e) {
        console.error("[downloads] release failed:", e);
        return serverError("Failed to remove torrent");
      }
    },
  )
  .get("/orphans", requireAdmin, async () => {
    try {
      const torrents = await listClientTorrents();
      if (torrents === null)
        return serviceUnavailable("Download client is unreachable");
      return ok(buildOrphans(torrents, await loadOwnedHashes()));
    } catch {
      return serverError("Failed to load orphaned torrents");
    }
  })
  .post(
    "/orphans/remove",
    requireAdmin,
    jsonV(
      z.object({
        hashes: z
          .array(z.string().regex(/^[0-9a-fA-F]{40}$/))
          .min(1)
          .max(500),
        delete_data: z.boolean(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const result = await removeOrphanTorrents(
          body.hashes,
          body.delete_data,
        );
        if (!result)
          return serviceUnavailable(
            "Download client is not configured or unreachable",
          );
        return ok(result);
      } catch {
        return serverError("Failed to remove orphaned torrents");
      }
    },
  )
  .get("/seed-rules", requireAdmin, async () => {
    try {
      const [indexers, overrides, ctx, held] = await Promise.all([
        listKnownIndexers(),
        prisma.indexerSeedRule.findMany(),
        loadSeedContext(),
        prisma.downloadHistory.findMany({
          where: {
            completedAt: { not: null },
            failed: false,
            seedReleasedAt: null,
            torrentHash: { not: null },
          },
          select: { indexer: true, torrentHash: true },
          distinct: ["torrentHash"],
        }),
      ]);
      const heldByIndexer = new Map<string, number>();
      for (const h of held) {
        const key = indexerKey(h.indexer);
        if (key) heldByIndexer.set(key, (heldByIndexer.get(key) ?? 0) + 1);
      }
      return ok({
        indexers: buildSeedRuleRows(indexers, overrides, heldByIndexer, ctx),
      });
    } catch {
      return serverError("Failed to load seed rules");
    }
  })
  .put(
    "/seed-rules/:indexer",
    requireAdmin,
    paramV(indexerParam),
    jsonV(ruleBody),
    async (c) => {
      const name = c.req.valid("param").indexer.trim();
      const body = c.req.valid("json");
      try {
        const existing = await prisma.indexerSeedRule.findFirst({
          where: { indexerName: { equals: name, mode: "insensitive" } },
        });
        const data = { ratio: body.ratio, seedTimeMins: body.seed_time_mins };
        const rule = existing
          ? await prisma.indexerSeedRule.update({
              where: { id: existing.id },
              data,
            })
          : await prisma.indexerSeedRule.create({
              data: { indexerName: name, ...data },
            });
        return ok({
          rule: {
            indexer: rule.indexerName,
            ratio: rule.ratio,
            seed_time_mins: rule.seedTimeMins,
          },
        });
      } catch {
        return serverError("Failed to save seed rule");
      }
    },
  )
  .delete(
    "/seed-rules/:indexer",
    requireAdmin,
    paramV(indexerParam),
    async (c) => {
      const name = c.req.valid("param").indexer.trim();
      try {
        const res = await prisma.indexerSeedRule.deleteMany({
          where: { indexerName: { equals: name, mode: "insensitive" } },
        });
        return ok({ deleted: res.count });
      } catch {
        return serverError("Failed to delete seed rule");
      }
    },
  )
  .get("/janitor-stats", requireAdmin, async () => {
    try {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const groups = await prisma.grabBlocklist.groupBy({
        by: ["kind"],
        where: { blockedAt: { gte: since }, kind: { not: null } },
        _count: { _all: true },
      });
      const count = (kind: string) =>
        groups.find((g) => g.kind === kind)?._count._all ?? 0;
      return ok({
        days: 30,
        stalled: count("stalled"),
        malware: count("malware"),
        import_rejected: count("import_rejected"),
      });
    } catch {
      return serverError("Failed to load janitor stats");
    }
  });
