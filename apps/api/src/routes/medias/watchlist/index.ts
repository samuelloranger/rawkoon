import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, serverError } from "@rawkoon/api/errors";

function parseYmdToDbDate(ymd: string | null | undefined): Date | null {
  if (ymd == null || ymd === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T00:00:00.000Z`);
}

export const mediasWatchlistRoutes = new Elysia({
  prefix: "/watchlist",
})
  .use(auth)
  .use(requireUser)

  // GET /api/medias/watchlist
  .get("/", async ({ user, set }) => {
    try {
      const items = await prisma.watchlistItem.findMany({
        where: { userId: user!.id },
        orderBy: { addedAt: "desc" },
      });
      return {
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
      };
    } catch {
      return serverError(set, "Failed to fetch watchlist");
    }
  })

  // POST /api/medias/watchlist — add (idempotent)
  .post(
    "/",
    async ({ user, body, set }) => {
      try {
        const isMovie = body.media_type === "movie";
        const movieDate = isMovie
          ? parseYmdToDbDate(body.release_date ?? undefined)
          : null;
        const item = await prisma.watchlistItem.upsert({
          where: {
            userId_tmdbId_mediaType: {
              userId: user!.id,
              tmdbId: body.tmdb_id,
              mediaType: body.media_type,
            },
          },
          create: {
            userId: user!.id,
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
        return { id: item.id, added: true };
      } catch {
        return serverError(set, "Failed to add to watchlist");
      }
    },
    {
      body: t.Object({
        tmdb_id: t.Number(),
        media_type: t.String(),
        title: t.String(),
        poster_url: t.Optional(t.Union([t.String(), t.Null()])),
        overview: t.Optional(t.Union([t.String(), t.Null()])),
        release_year: t.Optional(t.Union([t.Number(), t.Null()])),
        vote_average: t.Optional(t.Union([t.Number(), t.Null()])),
        release_date: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )

  // DELETE /api/medias/watchlist/:tmdbId?type=movie|tv
  .delete("/:tmdbId", async ({ user, params, query, set }) => {
    const tmdbId = parseInt(params.tmdbId, 10);
    if (isNaN(tmdbId)) return badRequest(set, "Invalid tmdbId");
    if (!query.type) return badRequest(set, "Missing type query param");

    try {
      await prisma.watchlistItem.deleteMany({
        where: { userId: user!.id, tmdbId, mediaType: query.type },
      });

      return { success: true };
    } catch {
      return serverError(set, "Failed to remove from watchlist");
    }
  });
