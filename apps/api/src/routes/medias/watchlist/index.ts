import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";

function parseYmdToDbDate(ymd: string | null | undefined): Date | null {
  if (ymd == null || ymd === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T00:00:00.000Z`);
}

// Mounted at /api/medias/watchlist by the medias parent (prefix dropped here).
export const mediasWatchlistRoutes = new Hono<Env>()
  .get("/", requireUser, async (c) => {
    try {
      const items = await prisma.watchlistItem.findMany({
        where: { userId: c.get("user").id },
        orderBy: { addedAt: "desc" },
      });
      return ok({
        items: items.map((item) => ({
          id: item.id,
          tmdb_id: item.tmdbId,
          media_type: item.mediaType as "movie" | "tv",
          title: item.title,
          poster_url: item.posterUrl,
          overview: item.overview,
          release_year: item.releaseYear,
          vote_average: item.voteAverage,
          added_at: item.addedAt.toISOString(),
          movie_release_date: item.movieReleaseDate
            ? item.movieReleaseDate.toISOString().slice(0, 10)
            : null,
        })),
      });
    } catch {
      return serverError("Failed to fetch watchlist");
    }
  })

  // POST /api/medias/watchlist — add (idempotent)
  .post(
    "/",
    requireUser,
    jsonV(
      // Zod strips unknown keys by default (no .strict()), so extra fields are ignored.
      z.object({
        tmdb_id: z.number(),
        media_type: z.string(),
        title: z.string(),
        poster_url: z.union([z.string(), z.null()]).optional(),
        overview: z.union([z.string(), z.null()]).optional(),
        release_year: z.union([z.number(), z.null()]).optional(),
        vote_average: z.union([z.number(), z.null()]).optional(),
        release_date: z.union([z.string(), z.null()]).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const isMovie = body.media_type === "movie";
        const movieDate = isMovie
          ? parseYmdToDbDate(body.release_date ?? undefined)
          : null;
        const item = await prisma.watchlistItem.upsert({
          where: {
            userId_tmdbId_mediaType: {
              userId: c.get("user").id,
              tmdbId: body.tmdb_id,
              mediaType: body.media_type,
            },
          },
          create: {
            userId: c.get("user").id,
            tmdbId: body.tmdb_id,
            mediaType: body.media_type,
            title: body.title,
            posterUrl: body.poster_url ?? null,
            overview: body.overview ?? null,
            releaseYear: body.release_year ?? null,
            voteAverage: body.vote_average ?? null,
            movieReleaseDate: isMovie ? movieDate : null,
            releaseReminderSentFor: null,
          },
          update: {
            ...(isMovie && body.release_date !== undefined
              ? { movieReleaseDate: movieDate, releaseReminderSentFor: null }
              : {}),
          },
        });
        return ok({ id: item.id, added: true });
      } catch {
        return serverError("Failed to add to watchlist");
      }
    },
  )

  // DELETE /api/medias/watchlist/:tmdbId?type=movie|tv
  .delete("/:tmdbId", requireUser, async (c) => {
    const tmdbId = parseInt(c.req.param("tmdbId"), 10);
    if (isNaN(tmdbId)) return badRequest("Invalid tmdbId");
    const type = c.req.query("type");
    if (!type) return badRequest("Missing type query param");

    try {
      await prisma.watchlistItem.deleteMany({
        where: { userId: c.get("user").id, tmdbId, mediaType: type },
      });

      return ok({ success: true });
    } catch {
      return serverError("Failed to remove from watchlist");
    }
  });
