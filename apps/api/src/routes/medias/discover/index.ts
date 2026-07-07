import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, serverError } from "@rawkoon/api/errors";
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

export const mediasDiscoverRoutes = new Elysia({ prefix: "/discover" })
  .use(auth)
  .use(requireUser)

  // GET /api/medias/discover/deck
  .get("/deck", async ({ user, set, query }) => {
    try {
      const tmdbConfig = await loadEnabledTmdbConfig();
      if (!tmdbConfig) {
        return badRequest(set, "TMDB is not configured");
      }
      const q = query as Record<string, string | undefined>;
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
      return await buildDiscoverDeck({
        provider,
        userId: user!.id,
        language,
        excludeTmdbIds,
        limit,
      });
    } catch (error) {
      console.error("Error building discover deck:", error);
      return serverError(set, "Failed to build discover deck");
    }
  })

  // POST /api/medias/discover/dismiss — idempotent
  .post(
    "/dismiss",
    async ({ user, body, set }) => {
      try {
        await prisma.discoverDismissal.upsert({
          where: {
            userId_tmdbId_mediaType: {
              userId: user!.id,
              tmdbId: body.tmdb_id,
              mediaType: body.type,
            },
          },
          create: {
            userId: user!.id,
            tmdbId: body.tmdb_id,
            mediaType: body.type,
          },
          update: {},
        });
        return { dismissed: true };
      } catch {
        return serverError(set, "Failed to dismiss media");
      }
    },
    {
      body: t.Object({
        tmdb_id: t.Number(),
        type: t.Union([t.Literal("movie"), t.Literal("tv")]),
      }),
    },
  )

  // DELETE /api/medias/discover/dismiss/:tmdbId?type=movie|tv
  .delete("/dismiss/:tmdbId", async ({ user, params, query, set }) => {
    const tmdbId = parseInt(params.tmdbId, 10);
    if (!Number.isFinite(tmdbId)) return badRequest(set, "Invalid tmdbId");
    if (query.type !== "movie" && query.type !== "tv") {
      return badRequest(set, "Missing or invalid type query param");
    }
    try {
      await prisma.discoverDismissal.deleteMany({
        where: { userId: user!.id, tmdbId, mediaType: query.type },
      });
      return { success: true };
    } catch {
      return serverError(set, "Failed to undo dismissal");
    }
  });
