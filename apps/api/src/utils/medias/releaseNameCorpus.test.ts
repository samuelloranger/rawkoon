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

const stem = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, "");

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
    const norm = (t: string) =>
      normalizeTitleForMatch(t).replace(/\s+/g, " ").trim();
    const mismatches: Record<string, Record<string, string>> = {
      seasonEpisode: {},
      rssTitle: {},
      downloadsImport: {},
    };
    for (const c of ALL_RELEASE_NAMES) {
      const t = c.truth;
      const se = parseReleaseSeasonEpisode(c.name);
      const wantSe =
        t.season == null
          ? null
          : { season: t.season, episode: t.episodes?.[0] ?? null };
      const gotSe = se ? { season: se.season, episode: se.episode } : null;
      if (JSON.stringify(gotSe) !== JSON.stringify(wantSe)) {
        mismatches.seasonEpisode[c.name] = JSON.stringify(gotSe);
      }

      const rss = extractTitleFromRelease(c.name);
      if (!rss || rss.normalizedTitle !== norm(t.title)) {
        mismatches.rssTitle[c.name] = JSON.stringify(rss?.normalizedTitle);
      } else if (t.year != null && rss.year != null && rss.year !== t.year) {
        mismatches.rssTitle[c.name] = `year ${rss.year}`;
      }

      const dl = buildParsed(c.name);
      if (norm(dl.title ?? "") !== norm(t.title)) {
        mismatches.downloadsImport[c.name] = JSON.stringify(dl.title);
      } else if ((dl.year ?? undefined) !== t.year) {
        mismatches.downloadsImport[c.name] = `year ${dl.year}`;
      }
    }
    expect(mismatches).toMatchSnapshot();
  });
});
