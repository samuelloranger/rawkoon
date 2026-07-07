import { Elysia, t } from "elysia";
import type { Prisma } from "@prisma/client";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serverError,
} from "@rawkoon/api/errors";
import { qualityProfileFormatsInclude } from "@rawkoon/api/services/mediaGrabberHelpers";

type ProfileWithFormats = Prisma.QualityProfileGetPayload<{
  include: typeof qualityProfileFormatsInclude;
}>;

// Dedupe by custom_format_id so a repeated id doesn't trip the
// (quality_profile_id, custom_format_id) unique constraint, which surfaces as
// a P2002 that would otherwise be misreported as a profile-name conflict.
function dedupeCustomFormats<T extends { custom_format_id: number }>(
  formats: T[],
): T[] {
  return Array.from(
    new Map(formats.map((f) => [f.custom_format_id, f])).values(),
  );
}

function mapProfile(p: ProfileWithFormats) {
  return {
    id: p.id,
    name: p.name,
    min_resolution: p.minResolution,
    preferred_sources: p.preferredSources,
    preferred_codecs: p.preferredCodecs,
    preferred_languages: p.preferredLanguages,
    prioritized_trackers: p.prioritizedTrackers,
    prefer_tracker_over_quality: p.preferTrackerOverQuality,
    max_size_gb: p.maxSizeGb,
    require_hdr: p.requireHdr,
    prefer_hdr: p.preferHdr,
    cutoff_resolution: p.cutoffResolution,
    min_seeders: p.minSeeders,
    custom_formats: (p.customFormats ?? []).map((l) => ({
      custom_format_id: l.customFormatId,
      name: l.customFormat.name,
      score: l.score,
      required: l.required,
      forbidden: l.forbidden,
    })),
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

const RESOLUTIONS = new Set([480, 720, 1080, 2160]);

export const qualityProfilesRoutes = new Elysia({
  prefix: "/api/quality-profiles",
})
  .use(auth)
  .use(requireUser)
  .get("/", async ({ set }) => {
    try {
      const rows = await prisma.qualityProfile.findMany({
        orderBy: { name: "asc" },
        include: qualityProfileFormatsInclude,
      });
      return { profiles: rows.map(mapProfile) };
    } catch {
      return serverError(set, "Failed to list quality profiles");
    }
  })
  .post(
    "/",
    async ({ user, body, set }) => {
      if (!user?.is_admin) return forbidden(set, "Admin access required");
      if (!RESOLUTIONS.has(body.min_resolution)) {
        return badRequest(
          set,
          "min_resolution must be 480, 720, 1080, or 2160",
        );
      }
      if (
        body.cutoff_resolution != null &&
        !RESOLUTIONS.has(body.cutoff_resolution)
      ) {
        return badRequest(
          set,
          "cutoff_resolution must be 480, 720, 1080, or 2160",
        );
      }
      try {
        const created = await prisma.$transaction(async (tx) => {
          const profile = await tx.qualityProfile.create({
            data: {
              name: body.name.trim(),
              minResolution: body.min_resolution,
              preferredSources: body.preferred_sources,
              preferredCodecs: body.preferred_codecs,
              preferredLanguages: body.preferred_languages ?? [],
              prioritizedTrackers: body.prioritized_trackers ?? [],
              preferTrackerOverQuality:
                body.prefer_tracker_over_quality ?? false,
              maxSizeGb: body.max_size_gb ?? null,
              requireHdr: body.require_hdr,
              preferHdr: body.prefer_hdr,
              cutoffResolution: body.cutoff_resolution ?? null,
              minSeeders: body.min_seeders ?? 0,
            },
          });
          if (
            body.custom_formats !== undefined &&
            body.custom_formats.length > 0
          ) {
            await tx.qualityProfileCustomFormat.createMany({
              data: dedupeCustomFormats(body.custom_formats).map((a) => ({
                qualityProfileId: profile.id,
                customFormatId: a.custom_format_id,
                score: a.score,
                required: a.required ?? false,
                forbidden: a.forbidden ?? false,
              })),
            });
          }
          return tx.qualityProfile.findUniqueOrThrow({
            where: { id: profile.id },
            include: qualityProfileFormatsInclude,
          });
        });
        set.status = 201;
        return { profile: mapProfile(created) };
      } catch (e: unknown) {
        const code =
          e && typeof e === "object" && "code" in e
            ? (e as { code: string }).code
            : null;
        if (code === "P2003")
          return badRequest(set, "unknown custom_format_id");
        if (code === "P2002")
          return conflict(set, "A profile with this name already exists");
        return serverError(set, "Failed to create quality profile");
      }
    },
    {
      body: t.Object({
        name: t.String(),
        min_resolution: t.Number(),
        preferred_sources: t.Array(t.String()),
        preferred_codecs: t.Array(t.String()),
        preferred_languages: t.Optional(t.Array(t.String())),
        prioritized_trackers: t.Optional(t.Array(t.String())),
        prefer_tracker_over_quality: t.Optional(t.Boolean()),
        max_size_gb: t.Optional(t.Nullable(t.Number())),
        require_hdr: t.Boolean(),
        prefer_hdr: t.Boolean(),
        cutoff_resolution: t.Optional(t.Nullable(t.Number())),
        min_seeders: t.Optional(t.Integer({ minimum: 0 })),
        custom_formats: t.Optional(
          t.Array(
            t.Object({
              custom_format_id: t.Integer(),
              score: t.Integer(),
              required: t.Optional(t.Boolean()),
              forbidden: t.Optional(t.Boolean()),
            }),
          ),
        ),
      }),
    },
  )
  .put(
    "/:id",
    async ({ user, params, body, set }) => {
      if (!user?.is_admin) return forbidden(set, "Admin access required");
      const id = parseInt(params.id, 10);
      if (!Number.isFinite(id)) return badRequest(set, "Invalid id");
      if (!RESOLUTIONS.has(body.min_resolution)) {
        return badRequest(
          set,
          "min_resolution must be 480, 720, 1080, or 2160",
        );
      }
      if (
        body.cutoff_resolution != null &&
        !RESOLUTIONS.has(body.cutoff_resolution)
      ) {
        return badRequest(
          set,
          "cutoff_resolution must be 480, 720, 1080, or 2160",
        );
      }
      try {
        const updated = await prisma.$transaction(async (tx) => {
          const existing = await tx.qualityProfile.findUnique({
            where: { id },
          });
          if (!existing) return null;
          await tx.qualityProfile.update({
            where: { id },
            data: {
              name: body.name.trim(),
              minResolution: body.min_resolution,
              preferredSources: body.preferred_sources,
              preferredCodecs: body.preferred_codecs,
              preferredLanguages: body.preferred_languages ?? [],
              prioritizedTrackers: body.prioritized_trackers ?? [],
              preferTrackerOverQuality:
                body.prefer_tracker_over_quality ?? false,
              maxSizeGb: body.max_size_gb ?? null,
              requireHdr: body.require_hdr,
              preferHdr: body.prefer_hdr,
              cutoffResolution: body.cutoff_resolution ?? null,
              minSeeders: body.min_seeders ?? existing.minSeeders,
            },
          });
          if (body.custom_formats !== undefined) {
            await tx.qualityProfileCustomFormat.deleteMany({
              where: { qualityProfileId: id },
            });
            if (body.custom_formats.length > 0) {
              await tx.qualityProfileCustomFormat.createMany({
                data: dedupeCustomFormats(body.custom_formats).map((a) => ({
                  qualityProfileId: id,
                  customFormatId: a.custom_format_id,
                  score: a.score,
                  required: a.required ?? false,
                  forbidden: a.forbidden ?? false,
                })),
              });
            }
          }
          return tx.qualityProfile.findUniqueOrThrow({
            where: { id },
            include: qualityProfileFormatsInclude,
          });
        });
        if (!updated) return notFound(set, "Quality profile not found");
        return { profile: mapProfile(updated) };
      } catch (e: unknown) {
        const code =
          e && typeof e === "object" && "code" in e
            ? (e as { code: string }).code
            : null;
        if (code === "P2003")
          return badRequest(set, "unknown custom_format_id");
        if (code === "P2002")
          return conflict(set, "A profile with this name already exists");
        return serverError(set, "Failed to update quality profile");
      }
    },
    {
      body: t.Object({
        name: t.String(),
        min_resolution: t.Number(),
        preferred_sources: t.Array(t.String()),
        preferred_codecs: t.Array(t.String()),
        preferred_languages: t.Optional(t.Array(t.String())),
        prioritized_trackers: t.Optional(t.Array(t.String())),
        prefer_tracker_over_quality: t.Optional(t.Boolean()),
        max_size_gb: t.Optional(t.Nullable(t.Number())),
        require_hdr: t.Boolean(),
        prefer_hdr: t.Boolean(),
        cutoff_resolution: t.Optional(t.Nullable(t.Number())),
        min_seeders: t.Optional(t.Integer({ minimum: 0 })),
        custom_formats: t.Optional(
          t.Array(
            t.Object({
              custom_format_id: t.Integer(),
              score: t.Integer(),
              required: t.Optional(t.Boolean()),
              forbidden: t.Optional(t.Boolean()),
            }),
          ),
        ),
      }),
    },
  )
  .delete("/:id", async ({ user, params, set }) => {
    if (!user?.is_admin) return forbidden(set, "Admin access required");
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return badRequest(set, "Invalid id");
    try {
      const existing = await prisma.qualityProfile.findUnique({
        where: { id },
      });
      if (!existing) return notFound(set, "Quality profile not found");
      const inUse = await prisma.libraryMedia.count({
        where: { qualityProfileId: id },
      });
      if (inUse > 0) {
        return conflict(
          set,
          "Cannot delete profile while library items are assigned to it",
        );
      }
      await prisma.qualityProfile.delete({ where: { id } });
      return { success: true };
    } catch {
      return serverError(set, "Failed to delete quality profile");
    }
  });
