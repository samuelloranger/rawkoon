import { prisma } from "@rawkoon/api/db";

export type BookQualityProfileInput = {
  name: string;
  kind: "ebook" | "audiobook" | "both";
  allowed_formats: string[];
  cutoff_format?: string | null;
  prefer_retail?: boolean;
  max_size_mb?: number | null;
  min_seeders?: number;
  min_audio_bitrate?: number | null;
  preferred_languages?: string[];
  prioritized_trackers?: string[];
  prefer_tracker_over_quality?: boolean;
};

export type BookQualityProfilePatch = Partial<BookQualityProfileInput>;

export const listBookQualityProfiles = () =>
  prisma.bookQualityProfile.findMany({ orderBy: { name: "asc" } });

export const findBookQualityProfile = (id: number) =>
  prisma.bookQualityProfile.findUnique({ where: { id } });

export const bookQualityProfileIdExists = async (id: number) =>
  (await prisma.bookQualityProfile.findUnique({
    where: { id },
    select: { id: true },
  })) !== null;

export const createBookQualityProfile = async (
  name: string,
  body: BookQualityProfileInput,
) => {
  try {
    const profile = await prisma.bookQualityProfile.create({
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
    return { created: true as const, profile };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return { created: false as const, reason: "duplicate_name" as const };
    }
    throw e;
  }
};

export const updateBookQualityProfile = (
  id: number,
  body: BookQualityProfilePatch,
) =>
  prisma.bookQualityProfile.update({
    where: { id },
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

export const deleteBookQualityProfile = async (id: number) => {
  await prisma.bookQualityProfile.delete({ where: { id } });
};
