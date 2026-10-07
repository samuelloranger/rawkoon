import { describe, expect, test } from "bun:test";
import { ALL_RELEASE_NAMES } from "../../testing/releaseNameCorpus";
import { parseReleaseStructure } from "../releaseStructure";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

type Want = {
  title: string;
  year?: number;
  season?: number;
  episodes?: number[];
  airDate?: string;
  seasonPack?: boolean;
  completeSeries?: boolean;
};

function diff(name: string, want: Want): string | null {
  const r = parseReleaseStructure(name);
  const errs: string[] = [];
  if (norm(r.title) !== norm(want.title))
    errs.push(`title=${JSON.stringify(r.title)}`);
  if (r.year !== (want.year ?? null)) errs.push(`year=${r.year}`);
  if (r.season !== (want.season ?? null)) errs.push(`season=${r.season}`);
  if (JSON.stringify(r.episodes) !== JSON.stringify(want.episodes ?? []))
    errs.push(`episodes=${JSON.stringify(r.episodes)}`);
  if (r.airDate !== (want.airDate ?? null)) errs.push(`airDate=${r.airDate}`);
  if (r.seasonPack !== !!want.seasonPack)
    errs.push(`seasonPack=${r.seasonPack}`);
  if (r.completeSeries !== !!want.completeSeries)
    errs.push(`completeSeries=${r.completeSeries}`);
  return errs.length ? `${name} -> ${errs.join(" ")}` : null;
}

describe("parseReleaseStructure", () => {
  test("matches the truth of every corpus name", () => {
    const failures = ALL_RELEASE_NAMES.map((c) => diff(c.name, c.truth)).filter(
      Boolean,
    );
    expect(failures).toEqual([]);
  });

  // Names assembled from parts, so the truth is known by construction.
  test("matches generated names across titles, markers, tags and separators", () => {
    const titles = [
      "Quiet Harbor",
      "The Last Light",
      "Ocean's 8",
      "Apollo 13",
      "District 9",
      "Night Shift",
      "Le Petit Prince",
      "Summer of 1985",
      "The 100",
      "Station 19",
      "A Quiet Place Part II",
      "Ça Commence",
      "X-Men Origins",
      "Up",
      "It",
    ];
    const tails = [
      "1080p.BluRay.x264-GRP",
      "2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.7.1-GRP",
      "720p.WEB-DL.DDP5.1.H.264-GRP",
      "1080p.AMZN.WEB-DL.DDP5.1.H.264-GRP",
      "MULTi.VFF.1080p.WEB.H265-GRP",
      "FRENCH.720p.HDTV.x264-GRP",
      "10bit.WEB.x265-GRP",
      "PROPER.1080p.WEB.h264-GRP",
      "60fps.1080p.WEB.h264-GRP",
      "2160p.WEB-DL.DV.HDR10+.H.265-GRP",
      "HDLight.1080p.x264.AC3-GRP",
      "DVDRip.XviD-GRP",
    ];
    const failures: string[] = [];
    for (const t of titles) {
      for (const tail of tails) {
        for (const sep of [".", " ", "_"]) {
          const T = t.replace(/ /g, sep);
          const tl = tail.replace(/\./g, sep);
          const cases: [string, Want][] = [
            [`${T}${sep}2021${sep}${tl}`, { title: t, year: 2021 }],
            [`${T}${sep}(1999)${sep}${tl}`, { title: t, year: 1999 }],
            [
              `${T}${sep}S02E07${sep}${tl}`,
              { title: t, season: 2, episodes: [7] },
            ],
            [
              `${T}${sep}S01E01E02${sep}${tl}`,
              { title: t, season: 1, episodes: [1, 2] },
            ],
            [
              `${T}${sep}S03${sep}${tl}`,
              { title: t, season: 3, seasonPack: true },
            ],
            [
              `${T}${sep}2019${sep}S01E05${sep}${tl}`,
              { title: t, year: 2019, season: 1, episodes: [5] },
            ],
            [
              `${T}${sep}3x09${sep}${tl}`,
              { title: t, season: 3, episodes: [9] },
            ],
          ];
          for (const [name, want] of cases) {
            const d = diff(name, want);
            if (d) failures.push(d);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("keeps a year that belongs to a show title as an alternative", () => {
    const r = parseReleaseStructure(
      "Quiet.Harbor.2019.S01E01.1080p.WEB.h264-GRP",
    );
    expect(r.title).toBe("Quiet Harbor");
    expect(r.titleWithYear).toBe("Quiet Harbor 2019");
    expect(parseReleaseStructure("Summer.of.1985.S01E01.WEB-GRP").title).toBe(
      "Summer of 1985",
    );
  });

  test("never reads a movie year as season and episode", () => {
    const r = parseReleaseStructure(
      "The.Long.Voyage.2021.1080p.BluRay.x264-GRP",
    );
    expect(r.season).toBeNull();
    expect(r.episodes).toEqual([]);
  });
});
