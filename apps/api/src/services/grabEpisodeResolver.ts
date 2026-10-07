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
 * - No requested episode: link a single-episode release (one SxxExx that is a
 *   known episode) to that episode; anything else stays unlinked (pack).
 * - Release SxxExx unparseable or season-only: keep the requested episode.
 * - Release SxxExx matches the requested episode: keep it.
 * - Release SxxExx points at another known episode of the same show: correct to
 *   that episode.
 * - Release SxxExx points at an episode not in the library: reject the grab.
 */
const EPISODE_MARKER_RE =
  /S\d{1,2}E\d{1,3}|(?:^|[\s._-])\d{1,2}x\d{1,3}(?!\d)/gi;
// E04E05, E04-E05, 4x04-05; "-720p", "-10bit" and "-5.1" are tags, not ranges.
const EPISODE_RANGE_RE =
  /(?:S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3})(?:[-_. ]?E\d{1,3}|-(?![257]\.[01](?!\d))\d{1,3}(?=[-_. ]|$))/i;

/** Whether a release covers more than one episode (a second marker or a range). */
export function isMultiEpisodeRelease(title: string): boolean {
  return (
    (title.match(EPISODE_MARKER_RE)?.length ?? 0) > 1 ||
    EPISODE_RANGE_RE.test(title)
  );
}

export function resolveGrabEpisodeId(opts: {
  requested: GrabEpisodeRef | null;
  releaseTitle: string;
  episodesBySeasonEpisode: Map<string, GrabEpisodeRef>;
}): ResolveGrabEpisodeResult {
  const { requested, releaseTitle, episodesBySeasonEpisode } = opts;
  const se = parseReleaseSeasonEpisode(releaseTitle);

  if (!requested) {
    // Show-level search sends no episode; unlinked, the grab is keyed as a pack.
    if (!se || se.episode == null || isMultiEpisodeRelease(releaseTitle)) {
      return { ok: true, episodeId: null, corrected: false };
    }
    const match = episodesBySeasonEpisode.get(
      episodeMapKey(se.season, se.episode),
    );
    return { ok: true, episodeId: match?.id ?? null, corrected: false };
  }

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

/**
 * Season half of the grab-target key. Infer from the title when interactive
 * grab omits it, otherwise two packs for one show share (media, null, null).
 */
export function resolveGrabSeason(opts: {
  mediaType: string;
  episodeId?: number | null;
  season?: number | null;
  releaseTitle: string;
}): number | null {
  if (opts.episodeId != null) return null;
  if (opts.season != null) return opts.season;
  if (opts.mediaType !== "show") return null;
  return parseReleaseSeasonEpisode(opts.releaseTitle)?.season ?? null;
}
