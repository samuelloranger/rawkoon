import {
  parseReleaseSeasonSpan,
  parseReleaseStructure,
} from "@rawkoon/shared/utils/releaseStructure";

const SEP = "[\\s._-]";
// "S01", "Saison 2", "Season.3": one named season ("Intégrale Saison 2" is a full season, not the series).
const SINGLE_SEASON = new RegExp(
  `(?:^|${SEP})(?:S(\\d{1,2})|(?:Seasons?|Saisons?|Staffel|Stagione|Temporada)${SEP}*(\\d{1,2}))(?=$|${SEP})`,
  "i",
);

/** The one season a title names, or null when it names none. */
export function singleSeasonNamed(title: string): number | null {
  const m = SINGLE_SEASON.exec(title);
  return m ? Number(m[1] ?? m[2]) : null;
}

/** Whether a release can be one season's pack: not an episode, a daily release, or another season's. */
export function fitsSeasonPack(title: string, season: number): boolean {
  const structure = parseReleaseStructure(title);
  if (structure.episodes.length > 0 || structure.airDate) return false;
  const named = structure.season ?? singleSeasonNamed(title);
  return named == null || named === season;
}

/**
 * Whether a release spans several seasons: a named range, or a complete-series
 * label that doesn't also pin a single season.
 */
export function isMultiSeasonRelease(title: string): boolean {
  const structure = parseReleaseStructure(title);
  if (structure.episodes.length > 0 || structure.airDate) return false;
  if (parseReleaseSeasonSpan(title)) return true;
  return structure.completeSeries && singleSeasonNamed(title) == null;
}

/**
 * Whether a release is a multi-season pack covering every wanted season. An
 * unranged "complete series" label is trusted: it names no seasons to check.
 */
export function releaseCoversSeasons(
  title: string,
  seasons: number[],
): boolean {
  if (!isMultiSeasonRelease(title)) return false;
  const span = parseReleaseSeasonSpan(title);
  return span ? seasons.every((s) => s >= span.from && s <= span.to) : true;
}

/** Whether a multi-season release carries `season`; a label without a range is assumed to. */
export function multiSeasonReleaseCovers(
  title: string,
  season: number,
): boolean {
  const span = parseReleaseSeasonSpan(title);
  return span ? season >= span.from && season <= span.to : true;
}
