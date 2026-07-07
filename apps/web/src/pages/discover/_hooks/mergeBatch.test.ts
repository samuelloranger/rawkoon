import { describe, it, expect } from "vitest";
import { mergeBatch } from "./mergeBatch";
import type { DiscoverDeckItem } from "@rawkoon/shared/types";

function item(tmdb_id: number): DiscoverDeckItem {
  return {
    id: `movie-${tmdb_id}`,
    tmdb_id,
    media_type: "movie",
    title: `T${tmdb_id}`,
    release_year: null,
    poster_url: null,
    overview: null,
    vote_average: null,
    genre_ids: [],
  };
}

describe("mergeBatch", () => {
  it("appends items not already served or queued", () => {
    const result = mergeBatch([item(1)], new Set([1, 2]), [item(2), item(3)]);
    expect(result.map((i) => i.tmdb_id)).toEqual([1, 3]);
  });

  it("dedupes within the incoming batch", () => {
    const result = mergeBatch([], new Set(), [item(4), item(4), item(5)]);
    expect(result.map((i) => i.tmdb_id)).toEqual([4, 5]);
  });

  it("returns the queue unchanged when all incoming are duplicates", () => {
    const queue = [item(1)];
    const result = mergeBatch(queue, new Set([2]), [item(1), item(2)]);
    expect(result.map((i) => i.tmdb_id)).toEqual([1]);
  });
});
