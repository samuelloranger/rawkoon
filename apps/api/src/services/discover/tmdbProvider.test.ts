import { describe, it, expect } from "bun:test";
import { toDeckItem } from "./tmdbProvider";

describe("toDeckItem", () => {
  it("maps a raw TMDB row with media_type and genre_ids", () => {
    const result = toDeckItem({
      id: 42,
      media_type: "movie",
      title: "Dune",
      release_date: "2021-10-22",
      poster_path: "/poster.jpg",
      overview: "Sand.",
      vote_average: 8.1,
      genre_ids: [878, 12],
    });
    expect(result).toEqual({
      id: "movie-42",
      tmdb_id: 42,
      media_type: "movie",
      title: "Dune",
      release_year: 2021,
      poster_url: "https://image.tmdb.org/t/p/w342/poster.jpg",
      overview: "Sand.",
      vote_average: 8.1,
      genre_ids: [878, 12],
    });
  });

  it("returns null when media_type is missing (unmappable)", () => {
    expect(toDeckItem({ id: 1, title: "x" })).toBeNull();
  });

  it("defaults genre_ids to [] and filters non-numbers", () => {
    const result = toDeckItem({
      id: 5,
      media_type: "tv",
      name: "Show",
      genre_ids: [1, "nope", 2],
    });
    expect(result?.genre_ids).toEqual([1, 2]);
  });
});
