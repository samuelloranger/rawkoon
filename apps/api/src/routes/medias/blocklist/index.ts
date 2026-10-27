import { Hono } from "hono";
import { z } from "zod";
import { notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV, queryV } from "@rawkoon/api/middleware/validate";
import {
  createBlocklistEntry,
  deleteBlocklistEntry,
  listBlocklistEntries,
} from "@rawkoon/api/services/medias/blocklist";
import { formatIso } from "@rawkoon/api/utils";

function formatEntry(e: {
  id: number;
  torrentHash: string | null;
  releaseTitle: string;
  indexer: string | null;
  mediaId: number | null;
  episodeId: number | null;
  reason: string | null;
  kind: string | null;
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
    kind: e.kind,
    blocked_at: formatIso(e.blockedAt),
  };
}

// Mounted under /api/medias; admin-only.
export const mediasBlocklistRoutes = new Hono<Env>()
  .get(
    "/blocklist",
    requireAdmin,
    queryV(z.object({ source: z.enum(["auto", "manual"]).optional() })),
    async (c) => {
      const source = c.req.valid("query").source;
      try {
        const entries = await listBlocklistEntries(source);
        return ok({ entries: entries.map(formatEntry) });
      } catch {
        return serverError("Failed to fetch blocklist");
      }
    },
  )
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
        const entry = await createBlocklistEntry({
          releaseTitle: body.release_title,
          torrentHash: body.torrent_hash,
          indexer: body.indexer,
          mediaId: body.media_id,
          episodeId: body.episode_id,
          reason: body.reason,
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
        if (!(await deleteBlocklistEntry(id))) {
          return notFound("Blocklist entry not found");
        }
        return ok({ success: true });
      } catch {
        return serverError("Failed to delete blocklist entry");
      }
    },
  );
