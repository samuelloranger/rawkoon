import { parseReleaseSeasonEpisode } from "@rawkoon/api/utils/medias/filenameParser";

export type GrabEpisodeRef = { id: number; season: number; episode: number };

export type ResolveGrabEpisodeResult =
  | { ok: true; episodeId: number | null; corrected: boolean }
  | { ok: false; reason: string };

/**
 * Decide which LibraryEpisode a show grab should be linked to.
 *
 * The interactive search panel tags every grabbed release with a single
 * episode context (the episode the panel was opened from). Grabbing a release
 * for a *different* episode from that panel would otherwise mislink it, so the
 * post-processor renders every grab to the same destination path and later
 * grabs fail with EEXIST. Guard against that by reconciling the requested
 * episode against the release's own SxxExx.
 *
 * - No requested episode (movie / season pack): pass through unchanged.
 * - Release SxxExx unparseable or season-only: keep the requested episode.
 * - Release SxxExx matches the requested episode: keep it.
 * - Release SxxExx points at another known episode of the same show: correct to
 *   that episode.
 * - Release SxxExx points at an episode not in the library: reject the grab.
 */
export function resolveGrabEpisodeId(opts: {
  requested: GrabEpisodeRef | null;
  releaseTitle: string;
  episodesBySeasonEpisode: Map<string, GrabEpisodeRef>;
}): ResolveGrabEpisodeResult {
  const { requested, releaseTitle, episodesBySeasonEpisode } = opts;

  if (!requested) return { ok: true, episodeId: null, corrected: false };

  const se = parseReleaseSeasonEpisode(releaseTitle);
  // Unparseable, or a season-only match (episode == null): can't reconcile, so
  // trust the requested episode rather than block a legitimate grab.
  if (!se || se.episode == null) {
    return { ok: true, episodeId: requested.id, corrected: false };
  }

  if (se.season === requested.season && se.episode === requested.episode) {
    return { ok: true, episodeId: requested.id, corrected: false };
  }

  const match = episodesBySeasonEpisode.get(`${se.season}x${se.episode}`);
  if (match) {
    return { ok: true, episodeId: match.id, corrected: true };
  }

  return {
    ok: false,
    reason: `Release "${releaseTitle}" (S${se.season}E${se.episode}) does not match a known episode of this show`,
  };
}

export function episodeMapKey(season: number, episode: number): string {
  return `${season}x${episode}`;
}
