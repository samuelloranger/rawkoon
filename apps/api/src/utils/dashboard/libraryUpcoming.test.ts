import { describe, expect, it } from "bun:test";
import type { DashboardUpcomingItem } from "@rawkoon/api/types/dashboardUpcoming";
import {
  episodeSpan,
  mergeUpcomingById,
} from "@rawkoon/api/utils/dashboard/libraryUpcoming";

const item = (id: string, title = id): DashboardUpcomingItem => ({
  id,
  title,
  media_type: "tv",
  release_date: "2026-01-01",
  poster_url: null,
  backdrop_url: null,
  overview: null,
  tmdb_url: "",
  providers: [],
  library_id: null,
  season_number: null,
  episode_number: null,
});

describe("episodeSpan", () => {
  it("gives the range for several episodes of one season", () => {
    expect(
      episodeSpan([
        { season: 1, episode: 4 },
        { season: 1, episode: 3 },
      ]),
    ).toEqual({
      season_number: 1,
      episode_number: 3,
      episode_number_end: 4,
      episode_count: 2,
    });
  });

  it("gives only the count when the episodes span seasons", () => {
    expect(
      episodeSpan([
        { season: 1, episode: 10 },
        { season: 2, episode: 1 },
      ]),
    ).toEqual({
      season_number: null,
      episode_number: null,
      episode_number_end: null,
      episode_count: 2,
    });
  });

  it("has no range for a single episode", () => {
    expect(episodeSpan([{ season: 2, episode: 5 }])).toEqual({
      season_number: 2,
      episode_number: 5,
      episode_number_end: null,
      episode_count: 1,
    });
  });
});

describe("mergeUpcomingById", () => {
  it("drops duplicate ids in the base list and keeps the first", () => {
    const merged = mergeUpcomingById(
      [item("tv-1", "first"), item("tv-1", "second"), item("tv-2")],
      [],
    );
    expect(merged.map((i) => i.title)).toEqual(["first", "tv-2"]);
  });

  it("prefers the base entry over an addition with the same id", () => {
    const merged = mergeUpcomingById(
      [item("tv-1", "base")],
      [item("tv-1", "library"), item("tv-3")],
    );
    expect(merged.map((i) => i.title)).toEqual(["base", "tv-3"]);
  });
});
