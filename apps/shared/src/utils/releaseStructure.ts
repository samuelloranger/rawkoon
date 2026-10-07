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
  `(?:^|${SEP})(\\d{1,2})x(\\d{2,3})((?:x\\d{2,3})*)(?:-(\\d{2,3}))?(?=$|${SEP})`,
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

// "S01E01", chains ("E01E02E03", "E01.E02") and ranges ("E01-E03", "E01-03").
const SXX_CHAIN =
  /\bS(\d{1,2})[\s.-]?E(\d{1,3})((?:[\s.]?-?[\s.]?E\d{1,3})*)(?:-(\d{1,3})(?=$|[\s.-]))?/i;

function sxxEpisodes(m: RegExpExecArray): number[] {
  const first = Number(m[2]);
  const rest = [...m[3].matchAll(/E(\d{1,3})/gi)].map((x) => Number(x[1]));
  if (m[4]) return range(first, Number(m[4]));
  if (rest.length > 0 && m[3].includes("-"))
    return range(first, rest[rest.length - 1]);
  return [first, ...rest];
}

const TV_MARKERS = [
  ["sxx", SXX_CHAIN],
  ["nx", NXNN],
  ["word", SEASON_WORD],
  ["season", SEASON_ONLY],
] as const;

// The earliest explicit TV marker; the title is everything before it.
function firstTvMarker(
  name: string,
): {
  kind: (typeof TV_MARKERS)[number][0];
  match: RegExpExecArray;
  start: number;
} | null {
  let best: {
    kind: (typeof TV_MARKERS)[number][0];
    match: RegExpExecArray;
    start: number;
  } | null = null;
  for (const [kind, re] of TV_MARKERS) {
    const global = new RegExp(re.source, "gi");
    for (let m = global.exec(name); m; m = global.exec(name)) {
      // Some markers include their leading separator; compare where the marker itself starts.
      const start =
        m.index + (m[0].length - m[0].replace(/^[\s._-]+/, "").length);
      // A season word with nothing before it names no show ("Series 7 ..."): look further.
      if ((kind === "word" || kind === "season") && start === 0) continue;
      if (!best || start < best.start) best = { kind, match: m, start };
      break;
    }
  }
  return best;
}

// Season/episode numbers come from explicit markers only: the underlying
// parser's TV mode misreads too many shapes (a movie year as S20E21, "E06.60fps"
// as a range, the first of three chained episodes dropped, "Ocean's.8" as S8).
function parseTv(name: string): ReleaseStructure | null {
  const marker = firstTvMarker(name);
  if (!marker) return null;
  const { kind, match, start } = marker;
  const split = splitTrailingYear(cleanTitle(name.slice(0, start)));
  const base = {
    ...empty(split.title),
    year: split.year,
    titleWithYear: split.titleWithYear,
  };
  if (kind === "sxx") {
    return { ...base, season: Number(match[1]), episodes: sxxEpisodes(match) };
  }
  if (kind === "nx") {
    const from = Number(match[2]);
    const chained = [...match[3].matchAll(/x(\d{2,3})/gi)].map((x) =>
      Number(x[1]),
    );
    return {
      ...base,
      season: Number(match[1]),
      episodes: match[4] ? range(from, Number(match[4])) : [from, ...chained],
    };
  }
  const season = /(\d{1,2})/.exec(match[0].replace(/^[\s._-]*\D*/, ""));
  return {
    ...base,
    season: season ? Number(season[1]) : null,
    seasonPack: true,
  };
}

const MAX_NAME_LENGTH = 512;

/**
 * Parse the title, year and season/episode structure of a release or file name.
 *
 * Movie titles and years come from @ctrl/video-filename-parser; TV structure
 * comes from explicit markers, so a name without one is always a movie.
 */
export function parseReleaseStructure(rawName: string): ReleaseStructure {
  const name = normalizeMarkers(
    rawName.trim().slice(0, MAX_NAME_LENGTH).replace(VIDEO_EXT, ""),
  );
  if (!name) return empty("");

  const complete = !SXXEYY.test(name) ? COMPLETE_SERIES.exec(name) : null;
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

  const tv = parseTv(name);
  if (tv) return tv;

  const movie = filenameParse(name, false);
  // The parser can leave a separator dot beside a symbol: "Fast &. Loud".
  const title = movie.title.replace(/\s+\.|\.\s+/g, " ").trim();
  return { ...empty(title), year: toYear(movie.year) };
}
