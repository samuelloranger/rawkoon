import { prisma } from "@rawkoon/api/db";
import { qualityProfileFormatsInclude } from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";

export type QualityProfileInput = {
  name: string;
  min_resolution: number;
  preferred_sources: string[];
  preferred_codecs: string[];
  preferred_languages?: string[];
  prioritized_trackers?: string[];
  prefer_tracker_over_quality?: boolean;
  max_size_gb?: number | null;
  require_hdr: boolean;
  prefer_hdr: boolean;
  cutoff_resolution?: number | null;
  min_seeders?: number;
  grab_delay_minutes?: number;
  bypass_delay_if_cutoff_met?: boolean;
  custom_formats?: Array<{
    custom_format_id: number;
    score: number;
    required?: boolean;
    forbidden?: boolean;
  }>;
};

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

const linkRows = (
  qualityProfileId: number,
  formats: NonNullable<QualityProfileInput["custom_formats"]>,
) =>
  dedupeCustomFormats(formats).map((a) => ({
    qualityProfileId,
    customFormatId: a.custom_format_id,
    score: a.score,
    required: a.required ?? false,
    forbidden: a.forbidden ?? false,
  }));

export const listQualityProfiles = () =>
  prisma.qualityProfile.findMany({
    orderBy: { name: "asc" },
    include: qualityProfileFormatsInclude,
  });

export const createQualityProfile = (
  body: QualityProfileInput,
  preferredSearchLanguage: string | null,
) =>
  prisma.$transaction(async (tx) => {
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
        grabDelayMinutes: body.grab_delay_minutes ?? 0,
        bypassDelayIfCutoffMet: body.bypass_delay_if_cutoff_met ?? true,
      },
    });
    if (body.custom_formats !== undefined && body.custom_formats.length > 0) {
      await tx.qualityProfileCustomFormat.createMany({
        data: linkRows(profile.id, body.custom_formats),
      });
    }
    return tx.qualityProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: qualityProfileFormatsInclude,
    });
  });

/** Null when the profile does not exist. */
export const updateQualityProfile = (
  id: number,
  body: QualityProfileInput,
  preferredSearchLanguage: string | null,
) =>
  prisma.$transaction(async (tx) => {
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
        grabDelayMinutes: body.grab_delay_minutes ?? existing.grabDelayMinutes,
        bypassDelayIfCutoffMet:
          body.bypass_delay_if_cutoff_met ?? existing.bypassDelayIfCutoffMet,
      },
    });
    if (body.custom_formats !== undefined) {
      await tx.qualityProfileCustomFormat.deleteMany({
        where: { qualityProfileId: id },
      });
      if (body.custom_formats.length > 0) {
        await tx.qualityProfileCustomFormat.createMany({
          data: linkRows(id, body.custom_formats),
        });
      }
    }
    return tx.qualityProfile.findUniqueOrThrow({
      where: { id },
      include: qualityProfileFormatsInclude,
    });
  });

export type DeleteQualityProfileResult =
  | { status: "not_found" }
  | { status: "in_use" }
  | { status: "deleted" };

export async function deleteQualityProfile(
  id: number,
): Promise<DeleteQualityProfileResult> {
  const existing = await prisma.qualityProfile.findUnique({ where: { id } });
  if (!existing) return { status: "not_found" };
  const inUse = await prisma.libraryMedia.count({
    where: { qualityProfileId: id },
  });
  if (inUse > 0) return { status: "in_use" };
  await prisma.qualityProfile.delete({ where: { id } });
  return { status: "deleted" };
}
