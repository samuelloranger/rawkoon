import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  loadEnabledTmdbConfig,
  resolveLanguage,
} from "@rawkoon/api/routes/medias/tmdb/tmdbRouteHelpers";
import { TmdbProvider } from "@rawkoon/api/services/discover/tmdbProvider";
import { buildDiscoverDeck } from "@rawkoon/api/services/discover/buildDiscoverDeck";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 40;

function parseExclude(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// Mounted at /api/medias/discover by the medias parent (prefix dropped here).
export const mediasDiscoverRoutes = new Hono<Env>()
  // GET /api/medias/discover/deck
  .get("/deck", requireUser, async (c) => {
    try {
      const tmdbConfig = await loadEnabledTmdbConfig();
      if (!tmdbConfig) {
        return badRequest("TMDB is not configured");
      }
      const q = c.req.query() as Record<string, string | undefined>;
      const language = resolveLanguage(q);
      const excludeTmdbIds = parseExclude(q.exclude);
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(
          1,
          parseInt(q.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
        ),
      );

      const provider = new TmdbProvider(tmdbConfig.api_key);
      return ok(
        await buildDiscoverDeck({
          provider,
          userId: c.get("user").id,
          language,
          excludeTmdbIds,
          limit,
        }),
      );
    } catch (error) {
      console.error("Error building discover deck:", error);
      return serverError("Failed to build discover deck");
    }
  })

  // POST /api/medias/discover/dismiss — idempotent
  .post(
    "/dismiss",
    requireUser,
    jsonV(
      z.object({
        tmdb_id: z.number(),
        type: z.union([z.literal("movie"), z.literal("tv")]),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      try {
        await prisma.discoverDismissal.upsert({
          where: {
            userId_tmdbId_mediaType: {
              userId: c.get("user").id,
              tmdbId: body.tmdb_id,
              mediaType: body.type,
            },
          },
          create: {
            userId: c.get("user").id,
            tmdbId: body.tmdb_id,
            mediaType: body.type,
          },
          update: {},
        });
        return ok({ dismissed: true });
      } catch {
        return serverError("Failed to dismiss media");
      }
    },
  )

  // DELETE /api/medias/discover/dismiss/:tmdbId?type=movie|tv
  .delete("/dismiss/:tmdbId", requireUser, async (c) => {
    const tmdbId = parseInt(c.req.param("tmdbId"), 10);
    if (!Number.isFinite(tmdbId)) return badRequest("Invalid tmdbId");
    const type = c.req.query("type");
    if (type !== "movie" && type !== "tv") {
      return badRequest("Missing or invalid type query param");
    }
    try {
      await prisma.discoverDismissal.deleteMany({
        where: { userId: c.get("user").id, tmdbId, mediaType: type },
      });
      return ok({ success: true });
    } catch {
      return serverError("Failed to undo dismissal");
    }
  });
