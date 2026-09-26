import { z } from "zod";

export const jobSettingsSchema = z
  .object({
    codec: z.enum(["hevc", "av1"]),
    encoder: z.enum(["software", "vaapi"]),
    resolution: z.union([z.literal("keep"), z.literal(1080), z.literal(720)]),
    mode: z.enum(["quality", "target"]),
    preset: z.enum(["high", "balanced", "small"]),
    quality: z.number().int().min(0).max(255).optional(),
    speed: z.enum(["slower", "default", "faster"]),
    targetVideoKbps: z.number().int().min(100).max(200_000).optional(),
    convertLosslessAudio: z.boolean(),
  })
  .refine((s) => s.mode !== "target" || s.targetVideoKbps != null, {
    message: "targetVideoKbps is required in target mode",
  });

export const selectionSchema = z
  .object({
    file_ids: z.array(z.number().int().positive()).min(1).max(2000).optional(),
    media_id: z.number().int().positive().optional(),
    season: z.number().int().min(0).optional(),
  })
  .refine((s) => (s.file_ids?.length ?? 0) > 0 || s.media_id != null, {
    message: "Select files or a media item",
  });

export const estimateBodySchema = z.object({
  selection: selectionSchema,
  settings: jobSettingsSchema,
  refine: z.boolean().optional(),
});

export const enqueueBodySchema = z.object({
  selection: selectionSchema,
  settings: jobSettingsSchema,
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const queueSettingsPatchSchema = z.object({
  paused: z.boolean().optional(),
  window_enabled: z.boolean().optional(),
  window_start: hhmm.optional(),
  window_end: hhmm.optional(),
  ssim_threshold: z.number().min(0.5).max(1).optional(),
  ssim_clip_min: z.number().min(0.5).max(1).optional(),
  cpu_threads: z.number().int().min(1).max(256).nullable().optional(),
});

export const moveBodySchema = z
  .object({
    top: z.literal(true).optional(),
    before_id: z.number().int().positive().optional(),
    after_id: z.number().int().positive().optional(),
  })
  .refine(
    (b) =>
      [b.top != null, b.before_id != null, b.after_id != null].filter(Boolean)
        .length === 1,
    { message: "Provide exactly one of top, before_id, after_id" },
  );

export type JobSettingsInput = z.infer<typeof jobSettingsSchema>;
