/**
 * A show's airing state comes from the TMDB status stored beside its library
 * status; the library status itself only tracks acquisition. Clients still read
 * the legacy composite value, which `presentLibraryStatus` reproduces.
 */

const AIRING_LEGACY_STATUS = {
  "Returning Series": "returning",
  "In Production": "in_production",
  Planned: "planned",
} as const;

/** TMDB statuses that mean a show is still airing, or about to. */
export const AIRING_TMDB_STATUSES: readonly string[] =
  Object.keys(AIRING_LEGACY_STATUS);

function legacyStatusFor(tmdbStatus: string | null | undefined): string | null {
  if (tmdbStatus == null || !Object.hasOwn(AIRING_LEGACY_STATUS, tmdbStatus)) {
    return null;
  }
  return AIRING_LEGACY_STATUS[tmdbStatus as keyof typeof AIRING_LEGACY_STATUS];
}

/** A missing TMDB status is not airing. */
export function isAiring(tmdbStatus: string | null | undefined): boolean {
  return legacyStatusFor(tmdbStatus) !== null;
}

/** The composite status clients expect; only a downloaded airing show differs from the stored value. */
export function presentLibraryStatus(media: {
  status: string;
  type: string;
  tmdbStatus: string | null | undefined;
}): string {
  if (media.status === "downloaded" && media.type === "show") {
    return legacyStatusFor(media.tmdbStatus) ?? media.status;
  }
  return media.status;
}

/** A status filter from a client, split into the stored status and the airing condition it implies. */
export type LibraryStatusInput =
  | { status: string; airing: "any" | "no" }
  | { status: "downloaded"; airing: "yes"; tmdbStatus: string };

/** Composite airing values mean "downloaded and airing", plain "downloaded" means "downloaded and not airing". */
export function parseLibraryStatusInput(status: string): LibraryStatusInput {
  for (const tmdbStatus of AIRING_TMDB_STATUSES) {
    if (legacyStatusFor(tmdbStatus) === status) {
      return { status: "downloaded", airing: "yes", tmdbStatus };
    }
  }
  return { status, airing: status === "downloaded" ? "no" : "any" };
}
