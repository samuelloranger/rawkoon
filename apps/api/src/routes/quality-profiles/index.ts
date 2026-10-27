import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
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
import type { qualityProfileFormatsInclude } from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import {
  createQualityProfile,
  deleteQualityProfile,
  listQualityProfiles,
  updateQualityProfile,
} from "@rawkoon/api/services/qualityProfiles/qualityProfileStore";

type ProfileWithFormats = Prisma.QualityProfileGetPayload<{
  include: typeof qualityProfileFormatsInclude;
}>;

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
    grab_delay_minutes: p.grabDelayMinutes,
    bypass_delay_if_cutoff_met: p.bypassDelayIfCutoffMet,
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
  grab_delay_minutes: z.number().int().min(0).max(43200).optional(),
  bypass_delay_if_cutoff_met: z.boolean().optional(),
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
      const rows = await listQualityProfiles();
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
      const created = await createQualityProfile(body, preferredSearchLanguage);
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
      const updated = await updateQualityProfile(
        id,
        body,
        preferredSearchLanguage,
      );
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
      const result = await deleteQualityProfile(id);
      if (result.status === "not_found") {
        return notFound("Quality profile not found");
      }
      if (result.status === "in_use") {
        return conflict(
          "Cannot delete profile while library items are assigned to it",
        );
      }
      return ok({ success: true });
    } catch {
      return serverError("Failed to delete quality profile");
    }
  })
  .notFound(() => notFound("Not found"));
