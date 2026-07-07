import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { formatIso } from "@rawkoon/api/utils";
import { notFound, serverError } from "@rawkoon/api/errors";

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
      body: t.Object({
        release_title: t.String({ minLength: 1 }),
        torrent_hash: t.Optional(t.String()),
        indexer: t.Optional(t.String()),
        media_id: t.Optional(t.Number()),
        episode_id: t.Optional(t.Number()),
        reason: t.Optional(t.String()),
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
    { params: t.Object({ id: t.Number() }) },
  );
