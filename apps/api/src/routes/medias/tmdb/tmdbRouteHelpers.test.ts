import { describe, it, expect } from "bun:test";
import { enrichSearchItems, libraryKey } from "./tmdbRouteHelpers";

describe("enrichSearchItems", () => {
  const raw = (id: number) => ({ id, media_type: "movie", title: `T${id}` });

  it("sets library_id and library_status for titles in the library", () => {
    const [inLib, notInLib] = enrichSearchItems(
      [raw(1), raw(2)],
      new Map([["movie:1", { id: 7, status: "wanted", airingState: null }]]),
    );
    expect(inLib).toMatchObject({
      already_exists: true,
      library_id: 7,
      library_status: "wanted",
    });
    expect(notInLib).toMatchObject({
      already_exists: false,
      library_id: null,
      library_status: null,
    });
  });

  it("keeps a movie and a show that share a TMDB id apart", () => {
    const [movie, show] = enrichSearchItems(
      [raw(1), { id: 1, media_type: "tv", name: "S1" }],
      new Map([
        [
          libraryKey(1, "show"),
          { id: 9, status: "downloaded", airingState: "returning" },
        ],
      ]),
    );
    expect(movie).toMatchObject({ already_exists: false, library_id: null });
    expect(show).toMatchObject({
      already_exists: true,
      library_id: 9,
      library_status: "downloaded",
      library_airing_state: "returning",
    });
  });
});

describe("libraryKey", () => {
  it("treats TMDB's tv and the library's show as the same type", () => {
    expect(libraryKey(5, "tv")).toBe(libraryKey(5, "show"));
    expect(libraryKey(5, "movie")).not.toBe(libraryKey(5, "show"));
  });
});
