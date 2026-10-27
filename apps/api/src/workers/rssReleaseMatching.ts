import type { pickReleaseForGrab } from "@rawkoon/api/utils/medias/pickReleaseForGrab";
import type { AiPickMediaContext } from "@rawkoon/api/utils/medias/buildAiPickPrompt";
import { normalizeTitleForMatch } from "@rawkoon/api/utils/medias/filenameParser";
import { resolveSearchTitles } from "@rawkoon/api/utils/medias/resolveSearchTitles";
import {
  parseReleaseSeasonSpan,
  parseReleaseStructure,
} from "@rawkoon/shared/utils/releaseStructure";

export function normalizedTitleSet(media: {
  title: string;
  searchTitle: string | null;
  originalTitle: string | null;
}): Set<string> {
  const { matchTitles } = resolveSearchTitles(media);
  return new Set(
    matchTitles
      .map((t) => normalizeTitleForMatch(t))
      .filter((t) => t.length > 0),
  );
}

export function tvMediaContext(
  title: string,
  season: number,
  episode: number | null = null,
): AiPickMediaContext {
  return { title, year: null, type: "tv", season, episode };
}

export function movieMediaContext(
  title: string,
  year: number | null,
): AiPickMediaContext {
  return { title, year, type: "movie" };
}

export function logRssMatch(
  best: Awaited<ReturnType<typeof pickReleaseForGrab>> & object,
  label: string,
) {
  const via = best.picked_by === "ai" ? "AI pick" : `score: ${best.score}`;
  console.log(
    `[pollIndexerRss] Match: "${best.release.title}" → ${label} (${via})`,
  );
}

/** A multi-season pack has no single season slot; the add-time search finds it, the feed doesn't match it as season N. */
export function matchableRssRelease(
  title: string,
): ReturnType<typeof extractTitleFromRelease> {
  return parseReleaseSeasonSpan(title) ? null : extractTitleFromRelease(title);
}

export function extractTitleFromRelease(title: string): {
  normalizedTitle: string;
  /** Show title with its trailing year kept, for shows named after a year. */
  normalizedTitleWithYear: string | null;
  season: number | null;
  episode: number | null;
  year: number | null;
} | null {
  if (!title) return null;
  const parsed = parseReleaseStructure(title);
  // Daily shows, absolute-numbered anime and whole-series packs have no
  // season/episode slot to match, and must not fall through to movie matching.
  if (
    parsed.season == null &&
    (parsed.episodes.length > 0 || parsed.airDate || parsed.completeSeries)
  ) {
    return null;
  }
  const normalizedTitle = normalizeTitleForMatch(parsed.title);
  if (!normalizedTitle) return null;
  const isTv = parsed.season != null;
  return {
    normalizedTitle,
    normalizedTitleWithYear: parsed.titleWithYear
      ? normalizeTitleForMatch(parsed.titleWithYear)
      : null,
    season: parsed.season,
    episode: isTv ? (parsed.episodes[0] ?? null) : null,
    year: isTv ? null : parsed.year,
  };
}

export function titleMatches(
  titles: Set<string>,
  parsed: { normalizedTitle: string; normalizedTitleWithYear: string | null },
): boolean {
  return (
    titles.has(parsed.normalizedTitle) ||
    (parsed.normalizedTitleWithYear != null &&
      titles.has(parsed.normalizedTitleWithYear))
  );
}
