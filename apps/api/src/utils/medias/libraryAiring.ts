/**
 * A show's airing state comes from the TMDB status stored beside its library
 * status; the library status itself only tracks acquisition.
 */
import type { AiringState } from "@rawkoon/shared/types";

/** Raw TMDB statuses behind each airing state. */
export const AIRING_STATE_TMDB_STATUSES: Record<
  AiringState,
  readonly string[]
> = {
  returning: ["Returning Series"],
  in_production: ["In Production"],
  planned: ["Planned"],
  ended: ["Ended", "Canceled"],
};

/** The airing label for a title; null for a movie or an unrecognised TMDB status. */
export function airingStateOf(media: {
  type: string;
  tmdbStatus: string | null | undefined;
}): AiringState | null {
  if (media.type !== "show" || media.tmdbStatus == null) return null;
  for (const [state, statuses] of Object.entries(AIRING_STATE_TMDB_STATUSES)) {
    if (statuses.includes(media.tmdbStatus)) return state as AiringState;
  }
  return null;
}
