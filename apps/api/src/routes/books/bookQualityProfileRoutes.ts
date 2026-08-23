import { Elysia, t } from "elysia";

import { requireUser, ensureAdmin } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, conflict, notFound } from "@rawkoon/api/errors";
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

/**
 * Book quality profiles. Reads are open to any user (the library UI needs the
 * names); writes are admin-only, matching how quality-profiles is gated.
 */
export const bookQualityProfileRoutes = new Elysia({
  prefix: "/api/book-quality-profiles",
})
  .use(requireUser)

  .get("/", async () => {
    const profiles = await prisma.bookQualityProfile.findMany({
      orderBy: { name: "asc" },
    });
    return { profiles: profiles.map(mapProfile) };
  })

  .get(
    "/:id",
    async ({ params, set }) => {
      const p = await prisma.bookQualityProfile.findUnique({
        where: { id: params.id },
      });
      if (!p) return notFound(set, "Book quality profile not found");
      return { profile: mapProfile(p) };
    },
    { params: t.Object({ id: t.Numeric() }) },
  )

  .post(
    "/",
    async ({ body, set, user }) => {
      const denied = ensureAdmin(user, set);
      if (denied) return denied;

      const name = body.name.trim();
      if (!name) return badRequest(set, "name is required");
      if (body.allowed_formats.length === 0) {
        return badRequest(set, "allowed_formats must not be empty");
      }
      const formatError = validateBookProfileFormats(
        body.kind,
        body.allowed_formats,
        body.cutoff_format ?? null,
      );
      if (formatError) return badRequest(set, formatError);

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
        return { profile: mapProfile(created) };
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") {
          return conflict(set, "A profile with that name already exists");
        }
        throw e;
      }
    },
    {
      body: t.Object({
        name: t.String(),
        kind: t.Union([
          t.Literal("ebook"),
          t.Literal("audiobook"),
          t.Literal("both"),
        ]),
        allowed_formats: t.Array(t.String()),
        cutoff_format: t.Optional(t.Nullable(t.String())),
        prefer_retail: t.Optional(t.Boolean()),
        max_size_mb: t.Optional(t.Nullable(t.Numeric())),
        min_seeders: t.Optional(t.Numeric()),
        min_audio_bitrate: t.Optional(t.Nullable(t.Numeric())),
        preferred_languages: t.Optional(t.Array(t.String())),
        prioritized_trackers: t.Optional(t.Array(t.String())),
        prefer_tracker_over_quality: t.Optional(t.Boolean()),
      }),
    },
  )

  .patch(
    "/:id",
    async ({ params, body, set, user }) => {
      const denied = ensureAdmin(user, set);
      if (denied) return denied;

      const existing = await prisma.bookQualityProfile.findUnique({
        where: { id: params.id },
      });
      if (!existing) return notFound(set, "Book quality profile not found");

      const kind = body.kind ?? existing.kind;
      const formats = body.allowed_formats ?? existing.allowedFormats;
      const cutoff =
        body.cutoff_format !== undefined
          ? body.cutoff_format
          : existing.cutoffFormat;

      if (formats.length === 0) {
        return badRequest(set, "allowed_formats must not be empty");
      }
      const formatError = validateBookProfileFormats(
        kind,
        formats,
        cutoff ?? null,
      );
      if (formatError) return badRequest(set, formatError);

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
      return { profile: mapProfile(updated) };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({
        name: t.Optional(t.String()),
        kind: t.Optional(
          t.Union([
            t.Literal("ebook"),
            t.Literal("audiobook"),
            t.Literal("both"),
          ]),
        ),
        allowed_formats: t.Optional(t.Array(t.String())),
        cutoff_format: t.Optional(t.Nullable(t.String())),
        prefer_retail: t.Optional(t.Boolean()),
        max_size_mb: t.Optional(t.Nullable(t.Numeric())),
        min_seeders: t.Optional(t.Numeric()),
        min_audio_bitrate: t.Optional(t.Nullable(t.Numeric())),
        preferred_languages: t.Optional(t.Array(t.String())),
        prioritized_trackers: t.Optional(t.Array(t.String())),
        prefer_tracker_over_quality: t.Optional(t.Boolean()),
      }),
    },
  )

  .delete(
    "/:id",
    async ({ params, set, user }) => {
      const denied = ensureAdmin(user, set);
      if (denied) return denied;

      const existing = await prisma.bookQualityProfile.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!existing) return notFound(set, "Book quality profile not found");

      // Editions keep working with no profile (they fall back to defaults),
      // so this is a SetNull rather than a blocked delete.
      await prisma.bookQualityProfile.delete({ where: { id: params.id } });
      return { deleted: true };
    },
    { params: t.Object({ id: t.Numeric() }) },
  );
