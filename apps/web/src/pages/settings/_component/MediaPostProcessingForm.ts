import { z } from "zod";

export const SELECT_CLASS =
  "focus-ring w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100";

export const LABEL_CLASS = "block text-sm font-medium text-neutral-300 mb-1.5";

export const mediaSettingsSchema = z.object({
  postProcessingEnabled: z.boolean(),
  moviesPath: z.string(),
  showsPath: z.string(),
  downloadsPath: z.string(),
  fileOperation: z.enum(["hardlink", "move"]),
  movieTemplate: z.string(),
  episodeTemplate: z.string(),
  defaultMovieQualityProfileId: z.string(),
  defaultShowQualityProfileId: z.string(),
  defaultBookQualityProfileId: z.string(),
  searchOnAdd: z.enum(["on", "off"]),
  askBeforeAdding: z.boolean(),
  requestersChooseSeasons: z.boolean(),
  defaultSeasonMode: z.enum(["all", "future", "latest"]),
  defaultMonitorNewSeasons: z.boolean(),
  rssPollIntervalMinutes: z.string(),
});

export type MediaSettingsFormValues = z.infer<typeof mediaSettingsSchema>;
