import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { queryV } from "@rawkoon/api/middleware/validate";
import { getArtworkCandidates } from "@rawkoon/api/services/images/artworkService";

const imagesQuery = z.object({
  kind: z.enum(["poster", "backdrop"]).optional(),
});

/**
 * Poster and backdrop candidates for the artwork picker.
 * GET /api/library/:id/images
 */
export const libraryImagesRoutes = new Hono<Env>().get(
  "/:id/images",
  requireUser,
  queryV(imagesQuery),
  async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return badRequest("Invalid id");
    const { kind = "poster" } = c.req.valid("query");

    try {
      const media = await prisma.libraryMedia.findUnique({
        where: { id },
        select: { tmdbId: true, type: true },
      });
      if (!media) return notFound("Library item not found");

      const candidates = await getArtworkCandidates({
        tmdbId: media.tmdbId,
        mediaType: media.type === "movie" ? "movie" : "tv",
        kind,
      });
      return ok({ candidates });
    } catch (error) {
      console.error("Error fetching artwork candidates:", error);
      return serverError("Failed to fetch artwork candidates");
    }
  },
);
