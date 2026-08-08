import { describe, expect, it } from "bun:test";
import {
  parsePartMarker,
  resolveSeasonPackMapping,
  type ParsedSourceFile,
  type ProviderEpisode,
} from "./seasonPackMapping";

function src(episode: number, fileName: string, ext = ".mkv"): ParsedSourceFile {
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
