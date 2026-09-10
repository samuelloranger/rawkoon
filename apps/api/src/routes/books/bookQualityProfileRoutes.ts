import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "@rawkoon/api/honoEnv";
import { ensureAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV } from "@rawkoon/api/middleware/validate";
import { prisma } from "@rawkoon/api/db";
import { badRequest, conflict, notFound, ok } from "@rawkoon/api/errors";
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
    const profiles = await prisma.bookQualityProfile.findMany({
      orderBy: { name: "asc" },
    });
    return ok({ profiles: profiles.map(mapProfile) });
  })

  .get("/:id", requireUser, paramV(idParam), async (c) => {
    const p = await prisma.bookQualityProfile.findUnique({
      where: { id: c.req.valid("param").id },
    });
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

      try {
        const created = await prisma.bookQualityProfile.create({
          data: {
            name,
            kind: body.kind,
            allowedFormats: body.allowed_formats,
            cutoffFormat: body.cutoff_format ?? null,
            preferRetail: body.prefer_retail ?? true,
            maxSizeMb: body.max_size_mb ?? null,
            minSeeders: body.min_seeders ?? 0,
            minAudioBitrate: body.min_audio_bitrate ?? null,
            preferredLanguages: body.preferred_languages ?? [],
            prioritizedTrackers: body.prioritized_trackers ?? [],
            preferTrackerOverQuality: body.prefer_tracker_over_quality ?? false,
          },
        });
        return ok({ profile: mapProfile(created) });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") {
          return conflict("A profile with that name already exists");
        }
        throw e;
      }
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
      const existing = await prisma.bookQualityProfile.findUnique({
        where: { id: params.id },
      });
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

      const updated = await prisma.bookQualityProfile.update({
        where: { id: params.id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.allowed_formats !== undefined
            ? { allowedFormats: body.allowed_formats }
            : {}),
          ...(body.cutoff_format !== undefined
            ? { cutoffFormat: body.cutoff_format }
            : {}),
          ...(body.prefer_retail !== undefined
            ? { preferRetail: body.prefer_retail }
            : {}),
          ...(body.max_size_mb !== undefined
            ? { maxSizeMb: body.max_size_mb }
            : {}),
          ...(body.min_seeders !== undefined
            ? { minSeeders: body.min_seeders }
            : {}),
          ...(body.min_audio_bitrate !== undefined
            ? { minAudioBitrate: body.min_audio_bitrate }
            : {}),
          ...(body.preferred_languages !== undefined
            ? { preferredLanguages: body.preferred_languages }
            : {}),
          ...(body.prioritized_trackers !== undefined
            ? { prioritizedTrackers: body.prioritized_trackers }
            : {}),
          ...(body.prefer_tracker_over_quality !== undefined
            ? { preferTrackerOverQuality: body.prefer_tracker_over_quality }
            : {}),
        },
      });
      return ok({ profile: mapProfile(updated) });
    },
  )

  .delete("/:id", requireUser, paramV(idParam), async (c) => {
    const denied = ensureAdmin(c.get("user"));
    if (denied) return denied;

    const params = c.req.valid("param");
    const existing = await prisma.bookQualityProfile.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) return notFound("Book quality profile not found");

    // Editions keep working with no profile (they fall back to defaults),
    // so this is a SetNull rather than a blocked delete.
    await prisma.bookQualityProfile.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  });
