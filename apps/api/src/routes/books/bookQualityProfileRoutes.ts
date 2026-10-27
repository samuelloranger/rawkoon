import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "@rawkoon/api/honoEnv";
import { ensureAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV } from "@rawkoon/api/middleware/validate";
import { badRequest, conflict, notFound, ok } from "@rawkoon/api/errors";
import {
  bookQualityProfileIdExists,
  createBookQualityProfile,
  deleteBookQualityProfile,
  findBookQualityProfile,
  listBookQualityProfiles,
  updateBookQualityProfile,
} from "@rawkoon/api/services/books/bookQualityProfileStore";
import type { BookQualityProfile } from "@rawkoon/shared/types";
import { validateBookProfileFormats } from "@rawkoon/shared/utils";

type ProfileRow = {
  id: number;
  name: string;
  kind: string;
  allowedFormats: string[];
  cutoffFormat: string | null;
  preferRetail: boolean;
  maxSizeMb: number | null;
  minSeeders: number;
  minAudioBitrate: number | null;
  preferredLanguages: string[];
  prioritizedTrackers: string[];
  preferTrackerOverQuality: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const mapProfile = (p: ProfileRow): BookQualityProfile => ({
  id: p.id,
  name: p.name,
  kind: p.kind as BookQualityProfile["kind"],
  allowed_formats: p.allowedFormats as BookQualityProfile["allowed_formats"],
  cutoff_format: p.cutoffFormat as BookQualityProfile["cutoff_format"],
  prefer_retail: p.preferRetail,
  max_size_mb: p.maxSizeMb,
  min_seeders: p.minSeeders,
  min_audio_bitrate: p.minAudioBitrate,
  preferred_languages: p.preferredLanguages,
  prioritized_trackers: p.prioritizedTrackers,
  prefer_tracker_over_quality: p.preferTrackerOverQuality,
  created_at: p.createdAt.toISOString(),
  updated_at: p.updatedAt.toISOString(),
});

const idParam = z.object({ id: z.coerce.number() });

/**
 * Book quality profiles. Reads are open to any user (the library UI needs the
 * names); writes are admin-only, matching how quality-profiles is gated.
 * Mounted by the edge at /api/book-quality-profiles.
 */
export const bookQualityProfileRoutes = new Hono<Env>()
  .get("/", requireUser, async () => {
    const profiles = await listBookQualityProfiles();
    return ok({ profiles: profiles.map(mapProfile) });
  })

  .get("/:id", requireUser, paramV(idParam), async (c) => {
    const p = await findBookQualityProfile(c.req.valid("param").id);
    if (!p) return notFound("Book quality profile not found");
    return ok({ profile: mapProfile(p) });
  })

  .post(
    "/",
    requireUser,
    jsonV(
      z.object({
        name: z.string(),
        kind: z.union([
          z.literal("ebook"),
          z.literal("audiobook"),
          z.literal("both"),
        ]),
        allowed_formats: z.array(z.string()),
        cutoff_format: z.string().nullable().optional(),
        prefer_retail: z.boolean().optional(),
        max_size_mb: z.coerce.number().nullable().optional(),
        min_seeders: z.coerce.number().optional(),
        min_audio_bitrate: z.coerce.number().nullable().optional(),
        preferred_languages: z.array(z.string()).optional(),
        prioritized_trackers: z.array(z.string()).optional(),
        prefer_tracker_over_quality: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;

      const body = c.req.valid("json");
      const name = body.name.trim();
      if (!name) return badRequest("name is required");
      if (body.allowed_formats.length === 0) {
        return badRequest("allowed_formats must not be empty");
      }
      const formatError = validateBookProfileFormats(
        body.kind,
        body.allowed_formats,
        body.cutoff_format ?? null,
      );
      if (formatError) return badRequest(formatError);

      const result = await createBookQualityProfile(name, body);
      if (!result.created) {
        return conflict("A profile with that name already exists");
      }
      return ok({ profile: mapProfile(result.profile) });
    },
  )

  .patch(
    "/:id",
    requireUser,
    paramV(idParam),
    jsonV(
      z.object({
        name: z.string().optional(),
        kind: z
          .union([
            z.literal("ebook"),
            z.literal("audiobook"),
            z.literal("both"),
          ])
          .optional(),
        allowed_formats: z.array(z.string()).optional(),
        cutoff_format: z.string().nullable().optional(),
        prefer_retail: z.boolean().optional(),
        max_size_mb: z.coerce.number().nullable().optional(),
        min_seeders: z.coerce.number().optional(),
        min_audio_bitrate: z.coerce.number().nullable().optional(),
        preferred_languages: z.array(z.string()).optional(),
        prioritized_trackers: z.array(z.string()).optional(),
        prefer_tracker_over_quality: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;

      const params = c.req.valid("param");
      const body = c.req.valid("json");
      const existing = await findBookQualityProfile(params.id);
      if (!existing) return notFound("Book quality profile not found");

      const kind = body.kind ?? existing.kind;
      const formats = body.allowed_formats ?? existing.allowedFormats;
      const cutoff =
        body.cutoff_format !== undefined
          ? body.cutoff_format
          : existing.cutoffFormat;

      if (formats.length === 0) {
        return badRequest("allowed_formats must not be empty");
      }
      const formatError = validateBookProfileFormats(
        kind,
        formats,
        cutoff ?? null,
      );
      if (formatError) return badRequest(formatError);

      const updated = await updateBookQualityProfile(params.id, body);
      return ok({ profile: mapProfile(updated) });
    },
  )

  .delete("/:id", requireUser, paramV(idParam), async (c) => {
    const denied = ensureAdmin(c.get("user"));
    if (denied) return denied;

    const params = c.req.valid("param");
    if (!(await bookQualityProfileIdExists(params.id)))
      return notFound("Book quality profile not found");

    // Editions keep working with no profile (they fall back to defaults),
    // so this is a SetNull rather than a blocked delete.
    await deleteBookQualityProfile(params.id);
    return ok({ deleted: true });
  });
