import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV } from "@rawkoon/api/middleware/validate";
import { formatIso } from "@rawkoon/api/utils";

/** Newest blocklist entries returned to the admin blocklist screen. */
const BLOCKLIST_LIMIT = 500;

function formatEntry(e: {
  id: number;
  torrentHash: string | null;
  releaseTitle: string;
  indexer: string | null;
  mediaId: number | null;
  episodeId: number | null;
  reason: string | null;
  blockedAt: Date;
}) {
  return {
    id: e.id,
    torrent_hash: e.torrentHash,
    release_title: e.releaseTitle,
    indexer: e.indexer,
    media_id: e.mediaId,
    episode_id: e.episodeId,
    reason: e.reason,
    blocked_at: formatIso(e.blockedAt),
  };
}

// Mounted under /api/medias; admin-only.
export const mediasBlocklistRoutes = new Hono<Env>()
  .get("/blocklist", requireAdmin, async () => {
    try {
      const entries = await prisma.grabBlocklist.findMany({
        orderBy: { blockedAt: "desc" },
        take: BLOCKLIST_LIMIT,
      });
      return ok({ entries: entries.map(formatEntry) });
    } catch {
      return serverError("Failed to fetch blocklist");
    }
  })
  .post(
    "/blocklist",
    requireAdmin,
    jsonV(
      z.object({
        release_title: z.string().min(1),
        torrent_hash: z.string().optional(),
        indexer: z.string().optional(),
        media_id: z.number().optional(),
        episode_id: z.number().optional(),
        reason: z.string().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const entry = await prisma.grabBlocklist.create({
          data: {
            releaseTitle: body.release_title,
            torrentHash: body.torrent_hash ?? null,
            indexer: body.indexer ?? null,
            mediaId: body.media_id ?? null,
            episodeId: body.episode_id ?? null,
            reason: body.reason ?? null,
          },
        });
        return ok({ entry: formatEntry(entry) });
      } catch {
        return serverError("Failed to add blocklist entry");
      }
    },
  )
  .delete(
    "/blocklist/:id",
    requireAdmin,
    paramV(z.object({ id: z.coerce.number() })),
    async (c) => {
      const { id } = c.req.valid("param");
      try {
        const existing = await prisma.grabBlocklist.findUnique({
          where: { id },
        });
        if (!existing) return notFound("Blocklist entry not found");

        await prisma.grabBlocklist.delete({ where: { id } });
        return ok({ success: true });
      } catch {
        return serverError("Failed to delete blocklist entry");
      }
    },
  );
