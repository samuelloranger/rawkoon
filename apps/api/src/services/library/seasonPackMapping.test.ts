import { describe, expect, it } from "bun:test";
import { extname } from "node:path";
import { parseSeasonEpisode } from "@rawkoon/api/services/postProcessor/postProcessorHelpers";
import {
  mapSeasonPack,
  parsePartMarker,
  resolveSeasonPackMapping,
  splitUnknownSeasons,
  type ParsedSourceFile,
  type ProviderEpisode,
  type RawSourceFile,
} from "./seasonPackMapping";

function src(
  episode: number,
  fileName: string,
  ext = ".mkv",
): ParsedSourceFile {
  return {
    path: `/dl/${fileName}`,
    fileName,
    season: 6,
    episode,
    part: parsePartMarker(fileName),
    ext,
  };
}

function providerSeason(count: number): ProviderEpisode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i + 1,
    season: 6,
    episode: i + 1,
    title: `Episode ${i + 1}`,
  }));
}

describe("parsePartMarker", () => {
  it("recognises the common part spellings", () => {
    expect(parsePartMarker("House.S06E01.Broken.Part.1.mkv")).toBe(1);
    expect(parsePartMarker("House - S06E02 - Broken Part 2.mkv")).toBe(2);
    expect(parsePartMarker("Show.S01E01.Pilot.Pt1.mkv")).toBe(1);
    expect(parsePartMarker("Show.S01E02.Pilot (2).mkv")).toBe(2);
  });

  it("returns null when no marker is present", () => {
    expect(parsePartMarker("House.S06E03.Epic.Fail.mkv")).toBeNull();
    expect(parsePartMarker("Show.S01E05.Apartment 4.mkv")).toBeNull();
  });
});

describe("resolveSeasonPackMapping", () => {
  it("maps a normal pack directly", () => {
    const sources = [src(1, "S06E01.A.mkv"), src(2, "S06E02.B.mkv")];
    const result = resolveSeasonPackMapping(sources, providerSeason(2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements).toHaveLength(2);
    expect(result.placements.every((p) => p.kind === "direct")).toBe(true);
  });

  it("still imports a partial pack", () => {
    const sources = [src(3, "S06E03.C.mkv"), src(7, "S06E07.G.mkv")];
    const result = resolveSeasonPackMapping(sources, providerSeason(21));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements).toHaveLength(2);
    expect(result.placements[0]!.episode.episode).toBe(3);
    expect(result.placements[1]!.episode.episode).toBe(7);
  });

  it("collapses a split premiere and renumbers the rest (House S6)", () => {
    const sources = [
      src(1, "House.S06E01.Broken.Part.1.mkv"),
      src(2, "House.S06E02.Broken.Part.2.mkv"),
      ...Array.from({ length: 20 }, (_, i) =>
        src(i + 3, `House.S06E${String(i + 3).padStart(2, "0")}.Ep.mkv`),
      ),
    ];
    const result = resolveSeasonPackMapping(sources, providerSeason(21));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.placements).toHaveLength(21);

    const first = result.placements[0]!;
    expect(first.kind).toBe("merge");
    expect(first.episode.episode).toBe(1);
    expect(first.sources.map((s) => s.fileName)).toEqual([
      "House.S06E01.Broken.Part.1.mkv",
      "House.S06E02.Broken.Part.2.mkv",
    ]);

    // Source E03 must land on provider E02, and the finale must not be lost.
    const second = result.placements[1]!;
    expect(second.kind).toBe("direct");
    expect(second.sources[0]!.episode).toBe(3);
    expect(second.episode.episode).toBe(2);

    const last = result.placements[20]!;
    expect(last.sources[0]!.episode).toBe(22);
    expect(last.episode.episode).toBe(21);
  });

  it("does not collapse a complete pack whose provider really has two-parters", () => {
    // Some shows genuinely list "Part 1"/"Part 2" as separate episodes. A
    // complete pack that already lines up 1:1 must be left alone.
    const sources = [
      src(1, "Show.S06E01.Finale.Part.1.mkv"),
      src(2, "Show.S06E02.Finale.Part.2.mkv"),
      src(3, "Show.S06E03.After.mkv"),
    ];
    const result = resolveSeasonPackMapping(sources, providerSeason(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements).toHaveLength(3);
    expect(result.placements.every((p) => p.kind === "direct")).toBe(true);
  });

  it("refuses a partial pack that uses split numbering", () => {
    // The regression that motivated this module: sources 1..4 all exist in a
    // 21-episode season, so nothing is "unmatched", but file 2 is Broken
    // Part 2 and mapping it directly would put it on episode 2 (Epic Fail).
    const sources = [
      src(1, "House.S06E01.Broken.Part.1.mkv"),
      src(2, "House.S06E02.Broken.Part.2.mkv"),
      src(3, "House.S06E03.Epic.Fail.mkv"),
    ];
    const result = resolveSeasonPackMapping(sources, providerSeason(21));
    expect(result.ok).toBe(false);
  });

  it("refuses a stray file that matches no episode", () => {
    const sources = [src(1, "S06E01.A.mkv"), src(99, "S06E99.Sample.mkv")];
    const result = resolveSeasonPackMapping(sources, providerSeason(21));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unmatched).toEqual(["S06E99.Sample.mkv"]);
  });

  it("refuses when part markers exist but the count still does not reconcile", () => {
    const sources = [
      src(1, "S06E01.Broken.Part.1.mkv"),
      src(2, "S06E02.Broken.Part.2.mkv"),
      src(3, "S06E03.C.mkv"),
      src(4, "S06E04.D.mkv"),
    ];
    // Collapsing yields 3 episodes, provider says 21 — the pack is incomplete
    // AND split, so we cannot safely renumber it.
    const result = resolveSeasonPackMapping(sources, providerSeason(21));
    expect(result.ok).toBe(false);
  });

  it("refuses to merge non-consecutive part markers", () => {
    const sources = [
      src(1, "S06E01.Broken.Part.1.mkv"),
      src(5, "S06E05.Other.Part.2.mkv"),
      src(2, "S06E02.B.mkv"),
    ];
    const result = resolveSeasonPackMapping(sources, providerSeason(2));
    expect(result.ok).toBe(false);
  });

  it("refuses to merge when a part is not an mkv", () => {
    const sources = [
      src(1, "S06E01.Broken.Part.1.mp4", ".mp4"),
      src(2, "S06E02.Broken.Part.2.mp4", ".mp4"),
      src(3, "S06E03.C.mp4", ".mp4"),
    ];
    const result = resolveSeasonPackMapping(sources, providerSeason(2));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("mkv");
  });
});

describe("mapSeasonPack", () => {
  // Two 12-episode seasons, as TMDB lists most cours-split anime.
  const provider: ProviderEpisode[] = [1, 2].flatMap((season) =>
    Array.from({ length: 12 }, (_, i) => ({
      id: season * 100 + i + 1,
      season,
      episode: i + 1,
      title: null,
    })),
  );
  const raw = (season: number | null, episode: number): RawSourceFile => ({
    path: `/dl/${episode}.mkv`,
    fileName: `${episode}.mkv`,
    season,
    episode,
    part: null,
    ext: ".mkv",
  });
  const placed = (sources: RawSourceFile[], target: number | null) => {
    const result = mapSeasonPack(sources, provider, target);
    if (!result.ok) throw new Error(result.reason);
    return result.placements.map(
      (p) => `${p.episode.season}x${p.episode.episode}`,
    );
  };
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  it("maps absolute numbers across seasons", () => {
    const got = placed(
      range(13, 24).map((e) => raw(null, e)),
      null,
    );
    expect(got).toEqual(range(1, 12).map((e) => `2x${e}`));
  });

  it("maps a season that continues the previous one's count", () => {
    const got = placed(
      range(13, 24).map((e) => raw(2, e)),
      2,
    );
    expect(got).toEqual(range(1, 12).map((e) => `2x${e}`));
  });

  it("puts season-less files on the grabbed season when they fit", () => {
    const got = placed(
      range(1, 12).map((e) => raw(null, e)),
      2,
    );
    expect(got).toEqual(range(1, 12).map((e) => `2x${e}`));
  });

  it("spreads an absolute complete-series pack over every season", () => {
    const got = placed(
      range(1, 24).map((e) => raw(null, e)),
      null,
    );
    expect(got).toHaveLength(24);
    expect(got.at(-1)).toBe("2x12");
  });

  it("keeps the original refusal when renumbering cannot place a file", () => {
    const result = mapSeasonPack([raw(null, 30)], provider, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("No parsable source files");
  });
});

describe("mapSeasonPack mixed named and season-less packs", () => {
  const provider = providerSeason(12);
  const file = (season: number | null, episode: number): RawSourceFile => ({
    path: `/dl/${season}-${episode}.mkv`,
    fileName: `${season ?? "abs"}-${episode}.mkv`,
    season,
    episode,
    part: null,
    ext: ".mkv",
  });

  it("maps every file when the season-less ones fit the grabbed season", () => {
    const result = mapSeasonPack(
      [file(6, 1), file(6, 2), file(null, 3), file(null, 4)],
      provider,
      6,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements.map((p) => p.episode.episode)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("imports the named files and reports season-less ones that cannot be placed", () => {
    const result = mapSeasonPack(
      [file(6, 1), file(6, 2), file(null, 40)],
      provider,
      6,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements.map((p) => p.episode.episode)).toEqual([1, 2]);
    expect(result.skipped).toEqual(["abs-40.mkv"]);
  });

  it("reports a season-less file that collides with a named one", () => {
    const result = mapSeasonPack([file(6, 2), file(null, 2)], provider, 6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements.map((p) => p.episode.episode)).toEqual([2]);
    expect(result.skipped).toEqual(["abs-2.mkv"]);
  });

  it("still maps an all-named pack as named", () => {
    const result = mapSeasonPack([file(6, 1), file(6, 2)], provider, 6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBeUndefined();
  });

  it("still maps an all-season-less pack onto the grabbed season", () => {
    const result = mapSeasonPack([file(null, 1), file(null, 2)], provider, 6);
    expect(result.ok).toBe(true);
  });
});

describe("mapSeasonPack season boundaries", () => {
  it("never moves a file that names its season into another season", () => {
    const provider: ProviderEpisode[] = [1, 2, 3].flatMap((season) =>
      Array.from({ length: 12 }, (_, i) => ({
        id: season * 100 + i + 1,
        season,
        episode: i + 1,
        title: `S${season}E${i + 1}`,
      })),
    );
    const file: RawSourceFile = {
      path: "/dl/Show.S02E25.mkv",
      fileName: "Show.S02E25.mkv",
      season: 2,
      episode: 25,
      part: null,
      ext: ".mkv",
    };
    expect(mapSeasonPack([file], provider, 2).ok).toBe(false);
  });

  const twoSeasons: ProviderEpisode[] = [1, 2].flatMap((season) =>
    Array.from({ length: 12 }, (_, i) => ({
      id: season * 100 + i + 1,
      season,
      episode: i + 1,
      title: `S${season}E${i + 1}`,
    })),
  );
  const seasonFile = (
    season: number | null,
    episode: number,
  ): RawSourceFile => ({
    path: `/dl/${season ?? "abs"}-${episode}.mkv`,
    fileName: `${season ?? "abs"}-${episode}.mkv`,
    season,
    episode,
    part: null,
    ext: ".mkv",
  });

  it("places absolute-numbered files across seasons without moving named ones", () => {
    const result = mapSeasonPack(
      [seasonFile(2, 1), seasonFile(null, 14), seasonFile(null, 15)],
      twoSeasons,
      null,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.placements.map((p) => [p.episode.season, p.episode.episode]),
    ).toEqual([
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    expect(result.skipped).toBeUndefined();
  });

  it("shifts continued numbering back alongside season-less files", () => {
    const result = mapSeasonPack(
      [seasonFile(2, 13), seasonFile(2, 14), seasonFile(null, 3)],
      twoSeasons,
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.placements.map((p) => [p.episode.season, p.episode.episode]),
    ).toEqual([
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
  });
});

describe("complete-series pack import", () => {
  const provider: ProviderEpisode[] = [
    [1, 3],
    [2, 2],
    [3, 2],
  ].flatMap(([season, count]) =>
    Array.from({ length: count }, (_, i) => ({
      id: season * 100 + i + 1,
      season,
      episode: i + 1,
      title: null,
    })),
  );
  const files = [
    "Show.S01E01.1080p.mkv",
    "Show.S01E02.1080p.mkv",
    "Show.S01E03.1080p.mkv",
    "Show.S02E01.1080p.mkv",
    "Show.S02E02.1080p.mkv",
    "Show.S03E01.1080p.mkv",
    "Show.S03E02.1080p.mkv",
  ];

  // The same file-name parsing the importer runs before mapping.
  const toSources = (names: string[]): RawSourceFile[] =>
    names.flatMap((fileName) => {
      const se = parseSeasonEpisode(fileName);
      return se
        ? [
            {
              path: `/dl/${fileName}`,
              fileName,
              season: se.season,
              episode: se.episode,
              part: parsePartMarker(fileName),
              ext: extname(fileName),
            },
          ]
        : [];
    });

  it("maps every file of a multi-season pack onto its own season's episode", () => {
    const sources = toSources(files);
    const { placeable, skipped } = splitUnknownSeasons(sources, provider);
    const result = mapSeasonPack(placeable, provider, null);
    expect(skipped).toEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements.map((p) => p.episode.id).sort()).toEqual([
      101, 102, 103, 201, 202, 301, 302,
    ]);
    for (const p of result.placements) {
      expect(p.kind).toBe("direct");
      expect(p.sources[0].season).toBe(p.episode.season);
      expect(p.sources[0].episode).toBe(p.episode.episode);
    }
  });

  it("sets aside seasons the provider lacks instead of refusing the pack", () => {
    const sources = toSources([...files, "Show.S00E01.Special.1080p.mkv"]);
    const refused = mapSeasonPack(sources, provider, null);
    expect(refused.ok).toBe(false);

    const { placeable, skipped } = splitUnknownSeasons(sources, provider);
    expect(skipped).toEqual(["Show.S00E01.Special.1080p.mkv"]);
    const result = mapSeasonPack(placeable, provider, null);
    expect(result.ok && result.placements).toHaveLength(7);
  });

  it("imports the seasons it has when the pack is missing some", () => {
    const { placeable } = splitUnknownSeasons(
      toSources(files.filter((f) => !f.includes("S02"))),
      provider,
    );
    const result = mapSeasonPack(placeable, provider, null);
    expect(
      result.ok && result.placements.map((p) => p.episode.id).sort(),
    ).toEqual([101, 102, 103, 301, 302]);
  });
});
