import { Elysia } from "elysia";
import { z } from "zod";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { formatIso } from "@rawkoon/api/utils";
import { notFound, serverError } from "@rawkoon/api/errors";

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

export const mediasBlocklistRoutes = new Elysia()
  .use(auth)
  .use(requireAdmin)
  .get("/blocklist", async ({ set }) => {
    try {
      const entries = await prisma.grabBlocklist.findMany({
        orderBy: { blockedAt: "desc" },
        take: BLOCKLIST_LIMIT,
      });
      return { entries: entries.map(formatEntry) };
    } catch {
      return serverError(set, "Failed to fetch blocklist");
    }
  })
  .post(
    "/blocklist",
    async ({ body, set }) => {
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
        return { entry: formatEntry(entry) };
      } catch {
        return serverError(set, "Failed to add blocklist entry");
      }
    },
    {
      body: z.object({
        release_title: z.string().min(1),
        torrent_hash: z.string().optional(),
        indexer: z.string().optional(),
        media_id: z.number().optional(),
        episode_id: z.number().optional(),
        reason: z.string().optional(),
      }),
    },
  )
  .delete(
    "/blocklist/:id",
    async ({ params, set }) => {
      try {
        const existing = await prisma.grabBlocklist.findUnique({
          where: { id: params.id },
        });
        if (!existing) return notFound(set, "Blocklist entry not found");

        await prisma.grabBlocklist.delete({ where: { id: params.id } });
        return { success: true };
      } catch {
        return serverError(set, "Failed to delete blocklist entry");
      }
    },
    { params: z.object({ id: z.number() }) },
  );
