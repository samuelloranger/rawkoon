import { describe, expect, it } from "vitest";
import type { LibraryEpisodesResponse } from "@rawkoon/shared/types";
import {
  choiceToBody,
  formatSeasonList,
  latestSeason,
  planSummary,
  seasonsFromEpisodes,
  seasonsFromTmdb,
  type SeasonChoice,
} from "../seasonPlan";

const TODAY = "2026-06-15";
const tmdb = [
  {
    season_number: 0,
    name: "Specials",
    episode_count: 3,
    air_date: "2020-01-01",
  },
  { season_number: 1, name: "S1", episode_count: 6, air_date: "2022-04-01" },
  { season_number: 2, name: "S2", episode_count: 6, air_date: "2023-04-01" },
  { season_number: 3, name: "S3", episode_count: 8, air_date: "2027-01-01" },
  { season_number: 4, name: "S4", episode_count: null, air_date: null },
];
const seasons = seasonsFromTmdb(tmdb, TODAY);
const choice = (c: Partial<SeasonChoice>): SeasonChoice => ({
  mode: "all",
  picked: [],
  newSeasons: true,
  ...c,
});

describe("seasonsFromTmdb", () => {
  it("drops specials and treats future or undated seasons as announced", () => {
    expect(
      seasons.map((s) => [s.number, s.announced, s.episodes.length]),
    ).toEqual([
      [1, false, 6],
      [2, false, 6],
      [3, true, 0],
      [4, true, 0],
    ]);
  });

  it("never picks an announced season as the latest", () => {
    expect(latestSeason(seasons)).toBe(2);
  });
});

describe("planSummary", () => {
  it("all seasons gets every aired episode plus new seasons", () => {
    expect(planSummary(seasons, choice({}))).toEqual({
      episodes: 12,
      seasons: [1, 2],
      newSeasons: true,
    });
  });

  it("future gets nothing that has aired but forces new seasons on", () => {
    expect(
      planSummary(seasons, choice({ mode: "future", newSeasons: false })),
    ).toEqual({
      episodes: 0,
      seasons: [],
      newSeasons: true,
    });
  });

  it("latest gets only the newest aired season", () => {
    expect(
      planSummary(seasons, choice({ mode: "latest", newSeasons: false })),
    ).toEqual({
      episodes: 6,
      seasons: [2],
      newSeasons: false,
    });
  });

  it("pick gets exactly the picked seasons", () => {
    expect(
      planSummary(seasons, choice({ mode: "pick", picked: [1] })),
    ).toMatchObject({
      episodes: 6,
      seasons: [1],
    });
  });
});

describe("seasonsFromEpisodes", () => {
  const ep = (episode: number, air_date: string | null) => ({
    id: episode,
    season: 1,
    episode,
    title: null,
    air_date,
    status: "wanted" as const,
    monitored: true,
    tmdb_episode_id: null,
    downloaded_at: null,
    search_attempts: 0,
  });
  const data = {
    seasons: [
      {
        season: 1,
        episodes: [
          ep(1, "2026-05-01"),
          ep(2, "2026-06-01"),
          ep(3, "2026-07-01"),
          ep(4, null),
        ],
      },
      { season: 2, episodes: [ep(1, "2027-01-01")] },
    ],
  } as unknown as LibraryEpisodesResponse;

  it("marks the unaired tail of the current season and announces a fully unaired one", () => {
    const s = seasonsFromEpisodes(data, TODAY);
    expect(s[0].episodes.map((e) => e.future)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(s[1].announced).toBe(true);
    expect(latestSeason(s)).toBe(1);
  });

  it("future mode lights only the unaired tail", () => {
    const s = seasonsFromEpisodes(data, TODAY);
    expect(planSummary(s, choice({ mode: "future" })).episodes).toBe(2);
  });
});

describe("helpers", () => {
  it("formats runs and gaps", () => {
    expect(formatSeasonList([1, 2, 3, 4, 5])).toBe("1–5");
    expect(formatSeasonList([1, 3])).toBe("1, 3");
    expect(formatSeasonList([4])).toBe("4");
  });

  it("builds the request body, sending seasons only for pick", () => {
    expect(choiceToBody(choice({ mode: "all" }))).toEqual({
      season_mode: "all",
      monitor_new_seasons: true,
    });
    expect(
      choiceToBody(choice({ mode: "pick", picked: [2], newSeasons: false })),
    ).toEqual({
      season_mode: "pick",
      seasons: [2],
      monitor_new_seasons: false,
    });
    expect(
      choiceToBody(choice({ mode: "future", newSeasons: false }))
        .monitor_new_seasons,
    ).toBe(true);
  });
});
