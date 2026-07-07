import { Elysia, t } from "elysia";
import { prisma } from "@rawkoon/api/db";
import { auth } from "@rawkoon/api/auth";
import { requireUser, requireAdmin } from "@rawkoon/api/middleware/auth";
import { badRequest, notFound } from "@rawkoon/api/errors";
import {
  createRequest,
  approveRequest,
  denyRequest,
} from "@rawkoon/api/services/mediaRequests";

function mapRequest(r: {
  id: number;
  tmdbId: number;
  type: string;
  title: string;
  posterUrl: string | null;
  year: number | null;
  status: string;
  requestedById: string;
  qualityProfileId: number | null;
  libraryMediaId: number | null;
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
    poster_url: r.posterUrl,
    year: r.year,
    status: r.status,
    requested_by: {
      id: r.requestedBy?.id ?? r.requestedById,
      name: r.requestedBy?.name ?? null,
    },
    quality_profile_id: r.qualityProfileId,
    library_media_id: r.libraryMediaId,
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
    });
    return { requests: rows.map(mapRequest) };
  })
  // POST /api/requests — any logged-in user creates a request
  .post(
    "/",
    async ({ body, user, set }) => {
      const result = await createRequest({
        tmdbId: body.tmdb_id,
        type: body.type,
        title: body.title,
        posterUrl: body.poster_url ?? null,
        year: body.year ?? null,
        userId: user!.id,
      });
      if (!result.ok) {
        return badRequest(
          set,
          result.reason === "exists_in_library"
            ? "Already in your library"
            : "Already requested",
        );
      }
      return { id: result.id };
    },
    {
      body: t.Object({
        tmdb_id: t.Number(),
        type: t.Union([t.Literal("movie"), t.Literal("show")]),
        title: t.String(),
        poster_url: t.Optional(t.Union([t.String(), t.Null()])),
        year: t.Optional(t.Union([t.Number(), t.Null()])),
      }),
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
              return notFound(set, "Request not found");
            if (result.reason === "invalid_profile")
              return badRequest(set, "Quality profile not found");
            return badRequest(set, "Request is not pending");
          }
          return { ok: true };
        },
        { body: t.Object({ quality_profile_id: t.Number() }) },
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
              ? notFound(set, "Request not found")
              : badRequest(set, "Request is not pending");
          }
          return { ok: true };
        },
        { body: t.Object({ deny_reason: t.Optional(t.String()) }) },
      ),
  );
