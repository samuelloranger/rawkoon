import { describe, expect, test } from "bun:test";
import { parseReleaseSeasonSpan } from "../releaseStructure";

describe("parseReleaseSeasonSpan", () => {
  test.each([
    ["Show.Name.S01-S03.COMPLETE.1080p.WEB", { from: 1, to: 3 }],
    ["Show Name S01-03 1080p WEB-DL", { from: 1, to: 3 }],
    ["Show.Name.S01.S02.S03.MULTi.1080p", { from: 1, to: 3 }],
    ["Show Name Seasons 1-4 Complete 720p", { from: 1, to: 4 }],
    ["Show Name Saisons 1 à 5 FRENCH 1080p", { from: 1, to: 5 }],
    ["Show.Name.Saison.1.a.3.FRENCH.1080p", { from: 1, to: 3 }],
    ["Show.Name.Season.2.to.6.1080p", { from: 2, to: 6 }],
  ])("reads the range of %s", (name, span) => {
    expect(parseReleaseSeasonSpan(name)).toEqual(span);
  });

  test.each([
    "Show.Name.S01.1080p.WEB-DL",
    "Show.Name.S01E01-E03.1080p",
    "Show.Name.S01E01.1080p",
    "Show.Name.S01-720p.WEB",
    "Show.Name.Integrale.MULTi.1080p.WEB",
    "Show Name Season 3 1080p",
  ])("finds no range in %s", (name) => {
    expect(parseReleaseSeasonSpan(name)).toBeNull();
  });
});
