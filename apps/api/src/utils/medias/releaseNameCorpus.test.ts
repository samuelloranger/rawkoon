import { describe, expect, test } from "bun:test";
import {
  ALL_RELEASE_NAMES,
  FILE_NAMES,
  MOVIE_RELEASES,
  TV_RELEASES,
} from "@rawkoon/shared/testing/releaseNameCorpus";
import {
  parseAudioFlags,
  parseFilenameMetadata,
  parseReleaseSeasonEpisode,
  parseReleaseTitle,
  normalizeTitleForMatch,
} from "@rawkoon/api/utils/medias/filenameParser";
import {
  isCompleteSeries,
  isSeasonPack,
} from "@rawkoon/api/utils/medias/mappers";
import { extractTitleFromRelease } from "@rawkoon/api/workers/pollIndexerRss";
import { buildParsed } from "@rawkoon/api/services/downloadsScanner";
import { parseFilenameForScan } from "@rawkoon/api/routes/library/libraryMediaAdmin";
import { inferSeasonFromReleaseTitle } from "@rawkoon/api/services/libraryAttentionCandidatesSeason";
import { parseSeasonEpisode } from "@rawkoon/api/services/postProcessorHelpers";
import { isMultiEpisodeRelease } from "@rawkoon/api/services/grabEpisodeResolver";

// Snapshots of every release/filename parser over the shared corpus, so a
// parser change shows up as a reviewable per-name diff.
const over = <T>(
  cases: { name: string }[],
  fn: (name: string) => T,
): Record<string, T> =>
  Object.fromEntries(cases.map((c) => [c.name, fn(c.name)]));

// Same extension set the importers strip; a bare 2–4 char suffix would eat ".x264".
const stem = (name: string) =>
  name.replace(/\.(mkv|mp4|avi|m4v|wmv|ts|m2ts|mov)$/i, "");

describe("release-name corpus", () => {
  test("parseReleaseTitle", () => {
    expect(over(ALL_RELEASE_NAMES, parseReleaseTitle)).toMatchSnapshot();
  });

  test("parseReleaseSeasonEpisode", () => {
    expect(
      over(ALL_RELEASE_NAMES, parseReleaseSeasonEpisode),
    ).toMatchSnapshot();
  });

  test("parseAudioFlags", () => {
    expect(over(ALL_RELEASE_NAMES, parseAudioFlags)).toMatchSnapshot();
  });

  test("parseFilenameMetadata", () => {
    expect(over(ALL_RELEASE_NAMES, parseFilenameMetadata)).toMatchSnapshot();
  });

  test("isSeasonPack / isCompleteSeries", () => {
    expect(
      over(TV_RELEASES, (n) => ({
        pack: isSeasonPack(n),
        complete: isCompleteSeries(n),
      })),
    ).toMatchSnapshot();
  });

  test("isMultiEpisodeRelease", () => {
    expect(over(TV_RELEASES, isMultiEpisodeRelease)).toMatchSnapshot();
  });

  test("inferSeasonFromReleaseTitle", () => {
    expect(over(TV_RELEASES, inferSeasonFromReleaseTitle)).toMatchSnapshot();
  });

  test("extractTitleFromRelease (RSS matching)", () => {
    expect(
      over([...MOVIE_RELEASES, ...TV_RELEASES], extractTitleFromRelease),
    ).toMatchSnapshot();
  });

  test("buildParsed (downloads import)", () => {
    expect(over(ALL_RELEASE_NAMES, buildParsed)).toMatchSnapshot();
  });

  test("parseFilenameForScan (library scan)", () => {
    expect(
      over(FILE_NAMES.concat(MOVIE_RELEASES), (n) =>
        parseFilenameForScan(stem(n)),
      ),
    ).toMatchSnapshot();
  });

  test("parseSeasonEpisode (season-pack file mapping)", () => {
    expect(
      over(FILE_NAMES.concat(TV_RELEASES), parseSeasonEpisode),
    ).toMatchSnapshot();
  });

  // Where today's structural parsing disagrees with the corpus truth.
  test("mismatches against truth", () => {
    const norm = (t: string) => normalizeTitleForMatch(t).trim();
    const show = (v: unknown) =>
      v === undefined ? "undefined" : JSON.stringify(v);
    const buckets = {
      seasonEpisode: {} as Record<string, string>,
      seasonPack: {} as Record<string, string>,
      multiEpisode: {} as Record<string, string>,
      completeSeries: {} as Record<string, string>,
      inferSeason: {} as Record<string, string>,
      packFileMapping: {} as Record<string, string>,
      rssTitle: {} as Record<string, string>,
      rssYear: {} as Record<string, string>,
      rssEpisode: {} as Record<string, string>,
      downloadsTitle: {} as Record<string, string>,
      downloadsYear: {} as Record<string, string>,
      downloadsEpisode: {} as Record<string, string>,
      scanTitle: {} as Record<string, string>,
      scanYear: {} as Record<string, string>,
    };
    const isTv = (t: (typeof ALL_RELEASE_NAMES)[number]["truth"]) =>
      t.season != null ||
      t.episodes != null ||
      t.airDate != null ||
      !!t.completeSeries;

    for (const { name, truth: t } of ALL_RELEASE_NAMES) {
      const firstEp = t.episodes?.[0] ?? null;
      const wantSe =
        t.season == null ? null : { season: t.season, episode: firstEp };
      const se = parseReleaseSeasonEpisode(name);
      if (show(se) !== show(wantSe)) buckets.seasonEpisode[name] = show(se);

      if (isTv(t)) {
        const pack = isSeasonPack(name);
        if (pack !== !!t.seasonPack) buckets.seasonPack[name] = show(pack);
        const multi = isMultiEpisodeRelease(name);
        if (multi !== (t.episodes?.length ?? 0) > 1)
          buckets.multiEpisode[name] = show(multi);
        const complete = isCompleteSeries(name);
        if (complete !== !!t.completeSeries)
          buckets.completeSeries[name] = show(complete);
        const inferred = inferSeasonFromReleaseTitle(name);
        if (inferred !== (t.season ?? null))
          buckets.inferSeason[name] = show(inferred);
        if (t.episodes?.length && t.season != null) {
          const mapped = parseSeasonEpisode(name);
          const want = { season: t.season, episode: firstEp };
          if (show(mapped) !== show(want))
            buckets.packFileMapping[name] = show(mapped);
        }
      }

      const rss = extractTitleFromRelease(name);
      if (!rss || rss.normalizedTitle !== norm(t.title)) {
        buckets.rssTitle[name] = show(rss?.normalizedTitle);
      }
      // RSS only uses the year to disambiguate movies.
      if (rss && !isTv(t) && rss.year !== (t.year ?? null)) {
        buckets.rssYear[name] = show(rss.year);
      }
      if (
        rss &&
        isTv(t) &&
        (rss.season !== (t.season ?? null) || rss.episode !== firstEp)
      ) {
        buckets.rssEpisode[name] = show({
          season: rss.season,
          episode: rss.episode,
        });
      }

      const dl = buildParsed(name);
      if (norm(dl.title ?? "") !== norm(t.title))
        buckets.downloadsTitle[name] = show(dl.title);
      if ((dl.year ?? null) !== (t.year ?? null))
        buckets.downloadsYear[name] = show(dl.year);
      if (
        isTv(t) &&
        ((dl.season ?? null) !== (t.season ?? null) ||
          (dl.episode ?? null) !== firstEp)
      ) {
        buckets.downloadsEpisode[name] = show({
          season: dl.season,
          episode: dl.episode,
        });
      }

      if (!isTv(t)) {
        const scan = parseFilenameForScan(stem(name));
        if (norm(scan.title) !== norm(t.title))
          buckets.scanTitle[name] = show(scan.title);
        if ((scan.year ?? null) !== (t.year ?? null))
          buckets.scanYear[name] = show(scan.year);
      }
    }
    expect(buckets).toMatchSnapshot();
  });
});
