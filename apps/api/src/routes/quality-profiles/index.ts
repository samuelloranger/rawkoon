import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  serverError,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
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
    preferred_search_language: p.preferredSearchLanguage ?? null,
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

function normalizePreferredSearchLanguage(
  value: string | null | undefined,
): string | null | { error: string } {
  if (value == null || value === "") return null;
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(trimmed)) {
    return { error: "preferred_search_language must be a 2-letter ISO code" };
  }
  return trimmed;
}

const profileBody = z.object({
  name: z.string(),
  min_resolution: z.number(),
  preferred_sources: z.array(z.string()),
  preferred_codecs: z.array(z.string()),
  preferred_languages: z.array(z.string()).optional(),
  preferred_search_language: z.string().nullable().optional(),
  prioritized_trackers: z.array(z.string()).optional(),
  prefer_tracker_over_quality: z.boolean().optional(),
  max_size_gb: z.number().nullable().optional(),
  require_hdr: z.boolean(),
  prefer_hdr: z.boolean(),
  cutoff_resolution: z.number().nullable().optional(),
  min_seeders: z.number().int().min(0).optional(),
  custom_formats: z
    .array(
      z.object({
        custom_format_id: z.number().int(),
        score: z.number().int(),
        required: z.boolean().optional(),
        forbidden: z.boolean().optional(),
      }),
    )
    .optional(),
});

const codeOf = (e: unknown): string | null =>
  e && typeof e === "object" && "code" in e
    ? (e as { code: string }).code
    : null;

// Mounted at /api/quality-profiles by the edge.
export const qualityProfilesRoutes = new Hono<Env>()
  .use("*", requireUser)
  .get("/", async () => {
    try {
      const rows = await prisma.qualityProfile.findMany({
        orderBy: { name: "asc" },
        include: qualityProfileFormatsInclude,
      });
      return ok({ profiles: rows.map(mapProfile) });
    } catch {
      return serverError("Failed to list quality profiles");
    }
  })
  .post("/", jsonV(profileBody), async (c) => {
    if (!c.get("user").is_admin) return forbidden("Admin access required");
    const body = c.req.valid("json");
    if (!RESOLUTIONS.has(body.min_resolution)) {
      return badRequest("min_resolution must be 480, 720, 1080, or 2160");
    }
    if (
      body.cutoff_resolution != null &&
      !RESOLUTIONS.has(body.cutoff_resolution)
    ) {
      return badRequest("cutoff_resolution must be 480, 720, 1080, or 2160");
    }
    const preferredSearchLanguage = normalizePreferredSearchLanguage(
      body.preferred_search_language,
    );
    if (
      preferredSearchLanguage &&
      typeof preferredSearchLanguage === "object" &&
      "error" in preferredSearchLanguage
    ) {
      return badRequest(preferredSearchLanguage.error);
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
            preferredSearchLanguage,
            prioritizedTrackers: body.prioritized_trackers ?? [],
            preferTrackerOverQuality: body.prefer_tracker_over_quality ?? false,
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
      return ok({ profile: mapProfile(created) }, 201);
    } catch (e: unknown) {
      const code = codeOf(e);
      if (code === "P2003") return badRequest("unknown custom_format_id");
      if (code === "P2002")
        return conflict("A profile with this name already exists");
      return serverError("Failed to create quality profile");
    }
  })
  .put("/:id", jsonV(profileBody), async (c) => {
    if (!c.get("user").is_admin) return forbidden("Admin access required");
    const id = parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return badRequest("Invalid id");
    const body = c.req.valid("json");
    if (!RESOLUTIONS.has(body.min_resolution)) {
      return badRequest("min_resolution must be 480, 720, 1080, or 2160");
    }
    if (
      body.cutoff_resolution != null &&
      !RESOLUTIONS.has(body.cutoff_resolution)
    ) {
      return badRequest("cutoff_resolution must be 480, 720, 1080, or 2160");
    }
    const preferredSearchLanguage = normalizePreferredSearchLanguage(
      body.preferred_search_language,
    );
    if (
      preferredSearchLanguage &&
      typeof preferredSearchLanguage === "object" &&
      "error" in preferredSearchLanguage
    ) {
      return badRequest(preferredSearchLanguage.error);
    }
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.qualityProfile.findUnique({ where: { id } });
        if (!existing) return null;
        await tx.qualityProfile.update({
          where: { id },
          data: {
            name: body.name.trim(),
            minResolution: body.min_resolution,
            preferredSources: body.preferred_sources,
            preferredCodecs: body.preferred_codecs,
            preferredLanguages: body.preferred_languages ?? [],
            preferredSearchLanguage,
            prioritizedTrackers: body.prioritized_trackers ?? [],
            preferTrackerOverQuality: body.prefer_tracker_over_quality ?? false,
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
      if (!updated) return notFound("Quality profile not found");
      return ok({ profile: mapProfile(updated) });
    } catch (e: unknown) {
      const code = codeOf(e);
      if (code === "P2003") return badRequest("unknown custom_format_id");
      if (code === "P2002")
        return conflict("A profile with this name already exists");
      return serverError("Failed to update quality profile");
    }
  })
  .delete("/:id", async (c) => {
    if (!c.get("user").is_admin) return forbidden("Admin access required");
    const id = parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return badRequest("Invalid id");
    try {
      const existing = await prisma.qualityProfile.findUnique({
        where: { id },
      });
      if (!existing) return notFound("Quality profile not found");
      const inUse = await prisma.libraryMedia.count({
        where: { qualityProfileId: id },
      });
      if (inUse > 0) {
        return conflict(
          "Cannot delete profile while library items are assigned to it",
        );
      }
      await prisma.qualityProfile.delete({ where: { id } });
      return ok({ success: true });
    } catch {
      return serverError("Failed to delete quality profile");
    }
  })
  .notFound(() => notFound("Not found"));
