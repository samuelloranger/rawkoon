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

/** TMDB statuses that mean a show is still airing, or about to. */
export const AIRING_TMDB_STATUSES: readonly string[] = [
  ...AIRING_STATE_TMDB_STATUSES.returning,
  ...AIRING_STATE_TMDB_STATUSES.in_production,
  ...AIRING_STATE_TMDB_STATUSES.planned,
];

/** A missing TMDB status is not airing. */
export function isAiring(tmdbStatus: string | null | undefined): boolean {
  return tmdbStatus != null && AIRING_TMDB_STATUSES.includes(tmdbStatus);
}

/** True for a show that is still airing or about to; a movie never is. */
export function isAiringShow(media: {
  type: string;
  tmdbStatus: string | null | undefined;
}): boolean {
  return media.type === "show" && isAiring(media.tmdbStatus);
}

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
