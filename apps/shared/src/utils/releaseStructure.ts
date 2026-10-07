import { filenameParse } from "@ctrl/video-filename-parser";

/** The structural part of a release or file name: what it is, not its quality. */
export type ReleaseStructure = {
  title: string;
  year: number | null;
  season: number | null;
  /** Every episode the release covers, in order; empty for packs and movies. */
  episodes: number[];
  /** Daily shows: the air date as YYYY-MM-DD. */
  airDate: string | null;
  seasonPack: boolean;
  /** The whole series ("Complete Series", "Intégrale"), not one season. */
  completeSeries: boolean;
  /**
   * When a trailing year was split off a show title ("Title 2019 S01E01"),
   * the title with it kept, for shows whose name really ends in a year.
   */
  titleWithYear: string | null;
};

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|ts|m2ts|wmv|mov|webm|mpg|mpeg)$/i;
const SEP = "[\\s._-]";
const DAILY = new RegExp(
  `(?:^|${SEP})((?:19|20)\\d{2})${SEP}(0[1-9]|1[0-2])${SEP}(0[1-9]|[12]\\d|3[01])(?=$|${SEP})`,
);
const SXXEYY = /\bS\d{1,2}[\s._-]?E\d{1,3}/i;
const NXNN = new RegExp(
  `(?:^|${SEP})(\\d{1,2})x(\\d{2,3})(?:-(\\d{2,3}))?(?=$|${SEP})`,
  "i",
);
const SEASON_WORD = new RegExp(
  `(?:^|${SEP})(?:Seasons?|Saisons?|Stagione|Temporada|Staffel|Series)${SEP}*(\\d{1,2})(?:${SEP}*-${SEP}*\\d{1,2})?(?=$|${SEP})`,
  "i",
);
const COMPLETE_SERIES = new RegExp(
  `${SEP}+(?:The${SEP}+)?(?:Complete${SEP}+(?:Series|Pack)|Int[ée]grale?)(?=$|${SEP})`,
  "i",
);
// A bare "Complete" only means the whole series when no season is named.
const COMPLETE_BARE = new RegExp(`${SEP}+Complete(?=$|${SEP})`, "i");
const SEASON_ONLY = new RegExp(`(?:^|${SEP})S\\d{1,2}(?=$|${SEP})`, "i");
// Fansub style: "[Group] Title S2 - 05" and "[Group] Title - 12".
const ANIME_SEASON_EP = /^\[[^\]]+\]\s*(.+?)\s+S(\d{1,2})\s+-\s+(\d{1,4})\b/i;
const ANIME_ABSOLUTE =
  /^\[[^\]]+\]\s*(.+?)\s+-\s+(\d{1,4})(?:v\d)?(?=$|[\s.([])/;
const TRAILING_YEAR = /^(.+?)[\s._]+\(?((?:19|20)\d{2})\)?$/;

const empty = (title: string): ReleaseStructure => ({
  title,
  year: null,
  season: null,
  episodes: [],
  airDate: null,
  seasonPack: false,
  completeSeries: false,
  titleWithYear: null,
});

// Rewrite marker spellings the underlying parser misreads into SxxEyy form.
function normalizeMarkers(name: string): string {
  return (
    name
      .replace(/_/g, ".")
      // "Season 2 E05" / "Saison 2 Episode 5" → "S02E05".
      .replace(
        /\b(?:Season|Saison|Stagione|Series)[\s.-]*(\d{1,2})[\s.-]*(?:E|Episode[\s.-]*)(\d{1,3})\b/i,
        (_m, s: string, e: string) =>
          `S${s.padStart(2, "0")}E${e.padStart(2, "0")}`,
      )
      // "S01E01-S01E02" → "S01E01-E02".
      .replace(/\b(S\d{1,2})(E\d{1,3})-\1(E\d{1,3})\b/i, "$1$2-$3")
      // "S03E04.S03E05" → "S03E04E05" (the parser keeps only the last marker).
      .replace(/\b(S\d{1,2})(E\d{1,3})[\s.-]+\1(E\d{1,3})\b/i, "$1$2$3")
      // "3x04-3x06" → "3x04-06".
      .replace(/\b(\d{1,2})x(\d{2,3})-\1x(\d{2,3})\b/i, "$1x$2-$3")
      // A tag right after the episode is not a range end ("-720p", ".60fps",
      // "-5.1"); the parser reads "E06.60fps" as episodes 6–60, so drop it.
      .replace(
        /\b(S\d{1,2}(?:[\s.-]?E\d{1,3})+)[\s.-]+(?:\d+[a-z]\w*|\d\.\d)(?=$|[\s.-])/gi,
        "$1",
      )
      // The parser reads "S01E01.10bit" as episodes 1–10; bit depth carries no structure.
      .replace(/[\s.-]\d{1,2}[\s.-]?bits?(?=$|[\s.-])/gi, "")
  );
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/[._]/g, " ")
    .replace(/[\s([-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toYear(value: string | null | undefined): number | null {
  const m = value?.match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

// A year after one of these words is part of the title ("Summer of 1985").
const YEAR_IN_TITLE_AFTER =
  /(?:^|\s)(?:of|in|from|since|after|before|until|to|the|by|at|for|circa|de|en|du)$/i;

// Shows disambiguated by year ("Title 2019 S01E01") keep the year out of the title.
function splitTrailingYear(title: string): {
  title: string;
  year: number | null;
  titleWithYear: string | null;
} {
  const m = title.match(TRAILING_YEAR);
  if (!m || YEAR_IN_TITLE_AFTER.test(m[1].trim())) {
    return { title, year: null, titleWithYear: null };
  }
  return {
    title: m[1].trim(),
    year: Number(m[2]),
    titleWithYear: `${m[1].trim()} ${m[2]}`,
  };
}

function range(from: number, to: number): number[] {
  if (to < from || to - from > 50) return [from];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function parseDaily(name: string): ReleaseStructure | null {
  const m = DAILY.exec(name);
  if (!m || m.index === 0) return null;
  return {
    ...empty(cleanTitle(name.slice(0, m.index))),
    airDate: `${m[1]}-${m[2]}-${m[3]}`,
  };
}

function parseAnime(name: string): ReleaseStructure | null {
  const se = ANIME_SEASON_EP.exec(name);
  if (se) {
    return {
      ...empty(cleanTitle(se[1])),
      season: Number(se[2]),
      episodes: [Number(se[3])],
    };
  }
  if (SXXEYY.test(name)) return null;
  const abs = ANIME_ABSOLUTE.exec(name);
  if (abs) return { ...empty(cleanTitle(abs[1])), episodes: [Number(abs[2])] };
  return null;
}

// Fallback for markers the library misses: "4x04-05", "Saison 2", "Stagione 2".
function parseMarkerFallback(name: string): ReleaseStructure | null {
  const nx = NXNN.exec(name);
  if (nx) {
    const from = Number(nx[2]);
    const to = nx[3] ? Number(nx[3]) : from;
    const split = splitTrailingYear(cleanTitle(name.slice(0, nx.index)));
    return {
      ...empty(split.title),
      year: split.year,
      titleWithYear: split.titleWithYear,
      season: Number(nx[1]),
      episodes: range(from, to),
    };
  }
  const sw = SEASON_WORD.exec(name);
  if (sw) {
    const split = splitTrailingYear(cleanTitle(name.slice(0, sw.index)));
    return {
      ...empty(split.title),
      year: split.year,
      titleWithYear: split.titleWithYear,
      season: Number(sw[1]),
      seasonPack: true,
    };
  }
  return null;
}

// The parser keeps only the last episode of an "NxAA-BB" range.
function nxRangeEpisodes(name: string): number[] | null {
  const nx = NXNN.exec(name);
  return nx?.[3] ? range(Number(nx[2]), Number(nx[3])) : null;
}

// Index where the first TV marker starts, or -1.
function tvMarkerIndex(name: string): number {
  let best = -1;
  for (const re of [SXXEYY, NXNN, SEASON_WORD, SEASON_ONLY]) {
    const m = re.exec(name);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/**
 * Parse the title, year and season/episode structure of a release or file name.
 *
 * TV parsing only runs when the name carries an explicit TV marker: the
 * underlying parser otherwise reads a movie year such as 2021 as S20E21.
 */
export function parseReleaseStructure(rawName: string): ReleaseStructure {
  const name = normalizeMarkers(rawName.trim().replace(VIDEO_EXT, ""));
  if (!name) return empty("");

  const complete =
    (!SXXEYY.test(name) && COMPLETE_SERIES.exec(name)) ||
    (tvMarkerIndex(name) === -1 && COMPLETE_BARE.exec(name)) ||
    null;
  if (complete) {
    const split = splitTrailingYear(cleanTitle(name.slice(0, complete.index)));
    return {
      ...empty(split.title),
      year: split.year,
      titleWithYear: split.titleWithYear,
      completeSeries: true,
    };
  }

  const daily = parseDaily(name);
  if (daily) return daily;

  const anime = parseAnime(name);
  if (anime) return anime;

  const marker = tvMarkerIndex(name);
  if (marker > 0) {
    // Apostrophes hide nothing structural but make "Ocean's.8" read as season 8.
    const tv = filenameParse(name.replace(/['’]/g, ""), true);
    if ("isTv" in tv && tv.seasons.length > 0) {
      const split = splitTrailingYear(cleanTitle(name.slice(0, marker)));
      return {
        ...empty(split.title),
        year: split.year ?? toYear(tv.year),
        titleWithYear: split.titleWithYear,
        season: tv.seasons[0],
        episodes: nxRangeEpisodes(name) ?? tv.episodeNumbers,
        seasonPack: tv.fullSeason,
      };
    }
    const fallback = parseMarkerFallback(name);
    if (fallback) return fallback;
  }

  const movie = filenameParse(name, false);
  // The parser can leave a separator dot beside a symbol: "Fast &. Loud".
  const title = movie.title.replace(/\s+\.|\.\s+/g, " ").trim();
  return { ...empty(title), year: toYear(movie.year) };
}
