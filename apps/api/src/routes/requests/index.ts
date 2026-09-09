import { Elysia } from "elysia";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { auth } from "@rawkoon/api/auth";
import { requireUser, requireAdmin } from "@rawkoon/api/middleware/auth";
import { badRequest, conflict, notFound } from "@rawkoon/api/errors";
import {
  createRequest,
  approveRequest,
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

export const requestRoutes = new Elysia({ prefix: "/api/requests" })
  .use(auth)
  .use(requireUser)
  // GET /api/requests — admins see all, users see their own
  .get("/", async ({ user }) => {
    const where = user!.is_admin ? {} : { requestedById: user!.id };
    const rows = await prisma.mediaRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { requestedBy: { select: { id: true, name: true } } },
      take: REQUEST_LIST_LIMIT,
    });
    return { requests: rows.map(mapRequest) };
  })
  // POST /api/requests — any logged-in user creates a request
  .post(
    "/",
    async ({ body, user, set }) => {
      const result = await createRequest(
        body.type === "book"
          ? {
              type: "book",
              googleVolumeId: body.google_volume_id,
              title: body.title,
              author: body.author ?? null,
              posterUrl: body.poster_url ?? null,
              year: body.year ?? null,
              userId: user!.id,
            }
          : {
              type: body.type,
              tmdbId: body.tmdb_id,
              title: body.title,
              posterUrl: body.poster_url ?? null,
              year: body.year ?? null,
              userId: user!.id,
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
      return { id: result.id };
    },
    {
      body: z.union([
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
      ]),
    },
  )
  // Admin-only sub-app for approve/deny
  .group("", (app) =>
    app
      .use(requireAdmin)
      .post(
        "/:id/approve",
        async ({ params, body, user, set }) => {
          const result = await approveRequest(
            parseInt(params.id, 10),
            body.quality_profile_id,
            user!.id,
          );
          if (!result.ok) {
            if (result.reason === "not_found")
              return notFound("Request not found");
            if (result.reason === "invalid_profile")
              return badRequest("Quality profile not found");
            return badRequest("Request is not pending");
          }
          return { ok: true };
        },
        { body: z.object({ quality_profile_id: z.number() }) },
      )
      .post(
        "/:id/deny",
        async ({ params, body, user, set }) => {
          const result = await denyRequest(
            parseInt(params.id, 10),
            user!.id,
            body.deny_reason,
          );
          if (!result.ok) {
            return result.reason === "not_found"
              ? notFound("Request not found")
              : badRequest("Request is not pending");
          }
          return { ok: true };
        },
        { body: z.object({ deny_reason: z.string().optional() }) },
      ),
  );
