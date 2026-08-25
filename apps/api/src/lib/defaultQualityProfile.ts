/** The two per-type default pointers on the MediaSettings singleton. */
export type DefaultQualityProfileSettings = {
  defaultMovieQualityProfileId: number | null;
  defaultShowQualityProfileId: number | null;
};

/**
 * Pick the settings-level default quality profile for a media type.
 *
 * Movies and shows carry independent defaults because their desired quality
 * usually differs (see issue #25). Callers that already know which profile
 * they want must not consult this — an explicit choice always wins.
 */
export function resolveDefaultQualityProfileId(
  type: "movie" | "show",
  settings: DefaultQualityProfileSettings | null | undefined,
): number | null {
  if (!settings) return null;
  return type === "movie"
    ? (settings.defaultMovieQualityProfileId ?? null)
    : (settings.defaultShowQualityProfileId ?? null);
}
