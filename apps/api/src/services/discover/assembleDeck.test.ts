import { describe, it, expect } from "bun:test";
import { assembleDeck, MIN_SEEDS } from "./assembleDeck";
import type { DiscoverDeckItem } from "@rawkoon/shared/types";

function item(
  tmdb_id: number,
  media_type: "movie" | "tv" = "movie",
): DiscoverDeckItem {
  return {
    id: `${media_type}-${tmdb_id}`,
    tmdb_id,
    media_type,
    title: `Title ${tmdb_id}`,
    release_year: 2020,
    poster_url: null,
    overview: null,
    vote_average: 7,
    genre_ids: [],
  };
}

describe("assembleDeck", () => {
  it("excludes owned/dismissed tmdb ids", () => {
    const res = assembleDeck({
      seedCount: 10,
      seededCandidates: [item(1), item(2), item(3)],
      fallbackCandidates: [],
      excludedTmdbIds: new Set([2]),
      limit: 20,
    });
    expect(res.items.map((i) => i.tmdb_id)).toEqual([1, 3]);
    expect(res.source).toBe("personalized");
  });

  it("dedupes repeated tmdb ids, keeping first", () => {
    const res = assembleDeck({
      seedCount: 10,
      seededCandidates: [item(1), item(1), item(2)],
      fallbackCandidates: [],
      excludedTmdbIds: new Set(),
      limit: 20,
    });
    expect(res.items.map((i) => i.tmdb_id)).toEqual([1, 2]);
  });

  it("uses trending source when seedCount < MIN_SEEDS", () => {
    const res = assembleDeck({
      seedCount: MIN_SEEDS - 1,
      seededCandidates: [],
      fallbackCandidates: [item(5), item(6)],
      excludedTmdbIds: new Set(),
      limit: 20,
    });
    expect(res.source).toBe("trending");
    expect(res.items.map((i) => i.tmdb_id)).toEqual([5, 6]);
  });

  it("tops up with fallback when seeded results are under the limit, without duplicating", () => {
    const res = assembleDeck({
      seedCount: 10,
      seededCandidates: [item(1)],
      fallbackCandidates: [item(1), item(2)],
      excludedTmdbIds: new Set(),
      limit: 20,
    });
    expect(res.items.map((i) => i.tmdb_id)).toEqual([1, 2]);
    expect(res.source).toBe("personalized");
  });

  it("falls back to trending source when seeded produced nothing after exclusion", () => {
    const res = assembleDeck({
      seedCount: 10,
      seededCandidates: [item(1)],
      fallbackCandidates: [item(9)],
      excludedTmdbIds: new Set([1]),
      limit: 20,
    });
    expect(res.items.map((i) => i.tmdb_id)).toEqual([9]);
    expect(res.source).toBe("trending");
  });

  it("respects the limit", () => {
    const res = assembleDeck({
      seedCount: 10,
      seededCandidates: [item(1), item(2), item(3)],
      fallbackCandidates: [],
      excludedTmdbIds: new Set(),
      limit: 2,
    });
    expect(res.items).toHaveLength(2);
  });
});
