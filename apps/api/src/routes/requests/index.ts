import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { badRequest, conflict, notFound, ok } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import {
  approveRequest,
  createRequest,
  denyRequest,
} from "@rawkoon/api/services/mediaRequests";

/** Newest requests returned to the requests screen. */
const REQUEST_LIST_LIMIT = 500;

function mapRequest(r: {
  id: number;
  tmdbId: number | null;
  type: string;
  title: string;
  author?: string | null;
  posterUrl: string | null;
  year: number | null;
  status: string;
  requestedById: string;
  qualityProfileId: number | null;
  libraryMediaId: number | null;
  googleVolumeId?: string | null;
  bookQualityProfileId?: number | null;
  libraryBookId?: number | null;
  denyReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  requestedBy?: { id: string; name: string | null } | null;
}) {
  return {
    id: r.id,
    tmdb_id: r.tmdbId,
    type: r.type,
    title: r.title,
    author: r.author ?? null,
    poster_url: r.posterUrl,
    year: r.year,
    status: r.status,
    requested_by: {
      id: r.requestedBy?.id ?? r.requestedById,
      name: r.requestedBy?.name ?? null,
    },
    quality_profile_id: r.qualityProfileId,
    library_media_id: r.libraryMediaId,
    google_volume_id: r.googleVolumeId ?? null,
    book_quality_profile_id: r.bookQualityProfileId ?? null,
    library_book_id: r.libraryBookId ?? null,
    deny_reason: r.denyReason,
    created_at: r.createdAt.toISOString(),
    decided_at: r.decidedAt ? r.decidedAt.toISOString() : null,
  };
}

const createBody = z.union([
  z.object({
    type: z.union([z.literal("movie"), z.literal("show")]),
    tmdb_id: z.number(),
    title: z.string(),
    poster_url: z.union([z.string(), z.null()]).optional(),
    year: z.union([z.number(), z.null()]).optional(),
  }),
  z.object({
    type: z.literal("book"),
    google_volume_id: z.string(),
    title: z.string(),
    author: z.union([z.string(), z.null()]).optional(),
    poster_url: z.union([z.string(), z.null()]).optional(),
    year: z.union([z.number(), z.null()]).optional(),
  }),
]);

// Mounted at /api/requests by the edge.
export const requestRoutes = new Hono<Env>()
  .use("*", requireUser)
  // GET /api/requests — admins see all, users see their own
  .get("/", async (c) => {
    const user = c.get("user");
    const where = user.is_admin ? {} : { requestedById: user.id };
    const rows = await prisma.mediaRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { requestedBy: { select: { id: true, name: true } } },
      take: REQUEST_LIST_LIMIT,
    });
    return ok({ requests: rows.map(mapRequest) });
  })
  // GET /api/requests/status — library + request state for one title, for clients
  // that show it on a title page without loading the whole request list.
  .get(
    "/status",
    queryV(
      z.object({
        tmdb_id: z.coerce.number().int().positive(),
        type: z.union([z.literal("movie"), z.literal("show")]),
      }),
    ),
    async (c) => {
      const { tmdb_id: tmdbId, type } = c.req.valid("query");
      const user = c.get("user");
      const [media, request] = await Promise.all([
        prisma.libraryMedia.findUnique({ where: { tmdbId } }),
        prisma.mediaRequest.findUnique({
          where: { tmdbId_type: { tmdbId, type } },
        }),
      ]);
      return ok({
        library:
          media && media.type === type
            ? {
                id: media.id,
                status: media.status,
                episode_count: media.episodeCount,
                downloaded_episode_count: media.downloadedEpisodeCount,
              }
            : null,
        // Someone else's request is shown by status only, like GET / hides it.
        request: request
          ? user.is_admin || request.requestedById === user.id
            ? {
                id: request.id,
                status: request.status,
                deny_reason: request.denyReason,
              }
            : { id: request.id, status: request.status, deny_reason: null }
          : null,
      });
    },
  )
  // POST /api/requests — any logged-in user creates a request
  .post("/", jsonV(createBody), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const result = await createRequest(
      body.type === "book"
        ? {
            type: "book",
            googleVolumeId: body.google_volume_id,
            title: body.title,
            author: body.author ?? null,
            posterUrl: body.poster_url ?? null,
            year: body.year ?? null,
            userId: user.id,
          }
        : {
            type: body.type,
            tmdbId: body.tmdb_id,
            title: body.title,
            posterUrl: body.poster_url ?? null,
            year: body.year ?? null,
            userId: user.id,
            autoApprove: !!user.is_admin,
          },
    );
    if (!result.ok) {
      // Duplicate requests use conflict() (409) so the client can special-case
      // "already requested" instead of showing a generic error; every other
      // rejection reason stays a 400.
      if (result.reason === "already_requested") {
        return conflict("Already requested");
      }
      return badRequest("Already in your library");
    }
    return ok({ id: result.id, status: result.status });
  })
  // Admin-only: approve / deny
  .post(
    "/:id/approve",
    requireAdmin,
    jsonV(z.object({ quality_profile_id: z.number() })),
    async (c) => {
      const result = await approveRequest(
        parseInt(c.req.param("id"), 10),
        c.req.valid("json").quality_profile_id,
        c.get("user").id,
      );
      if (!result.ok) {
        if (result.reason === "not_found") return notFound("Request not found");
        if (result.reason === "invalid_profile")
          return badRequest("Quality profile not found");
        return badRequest("Request is not pending");
      }
      return ok({ ok: true });
    },
  )
  .post(
    "/:id/deny",
    requireAdmin,
    jsonV(z.object({ deny_reason: z.string().optional() })),
    async (c) => {
      const result = await denyRequest(
        parseInt(c.req.param("id"), 10),
        c.get("user").id,
        c.req.valid("json").deny_reason,
      );
      if (!result.ok) {
        return result.reason === "not_found"
          ? notFound("Request not found")
          : badRequest("Request is not pending");
      }
      return ok({ ok: true });
    },
  )
  .notFound(() => notFound("Not found"));
