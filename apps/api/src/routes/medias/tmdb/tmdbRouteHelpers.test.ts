import { describe, it, expect } from "bun:test";
import {
  enrichSearchItems,
  libraryKey,
  exploreBaseCacheKey,
  getExploreBaseSections,
  type ExploreBaseSections,
} from "./tmdbRouteHelpers";

const emptySections = (): ExploreBaseSections => ({
  trending: [],
  popular_movies: [],
  popular_shows: [],
  upcoming_movies: [],
  now_playing: [],
  airing_today: [],
  on_the_air: [],
  top_rated_movies: [],
  top_rated_shows: [],
});

describe("exploreBaseCacheKey", () => {
  it("keys by language and region", () => {
    expect(exploreBaseCacheKey("en-US", "US")).toBe(
      "medias:explore:base:en-US:US",
    );
    expect(exploreBaseCacheKey("fr-CA", "CA")).toBe(
      "medias:explore:base:fr-CA:CA",
    );
  });
});

describe("getExploreBaseSections", () => {
  it("returns cached sections without fetching on a hit", async () => {
    const cached = { ...emptySections(), trending: [{ id: 1 }] };
    let fetched = false;
    let setCalled = false;
    const res = await getExploreBaseSections({
      cacheKey: "k",
      ttlSeconds: 900,
      skipCache: false,
      getCache: async () => cached as unknown as never,
      setCache: async () => {
        setCalled = true;
      },
      fetchSections: async () => {
        fetched = true;
        return emptySections();
      },
    });
    expect(res.cacheHit).toBe(true);
    expect(res.sections.trending).toEqual([{ id: 1 }]);
    expect(fetched).toBe(false);
    expect(setCalled).toBe(false);
  });

  it("fetches and caches on a miss", async () => {
    let fetched = false;
    let setValue: unknown = null;
    const res = await getExploreBaseSections({
      cacheKey: "k",
      ttlSeconds: 900,
      skipCache: false,
      getCache: async () => null,
      setCache: async (_k, v) => {
        setValue = v;
      },
      fetchSections: async () => {
        fetched = true;
        return { ...emptySections(), popular_movies: [{ id: 9 }] };
      },
    });
    expect(res.cacheHit).toBe(false);
    expect(fetched).toBe(true);
    expect((setValue as ExploreBaseSections).popular_movies).toEqual([
      { id: 9 },
    ]);
  });

  it("skips the cache read when skipCache is true", async () => {
    let getCalled = false;
    let fetched = false;
    const res = await getExploreBaseSections({
      cacheKey: "k",
      ttlSeconds: 900,
      skipCache: true,
      getCache: async () => {
        getCalled = true;
        return emptySections() as unknown as never;
      },
      setCache: async () => {},
      fetchSections: async () => {
        fetched = true;
        return emptySections();
      },
    });
    expect(getCalled).toBe(false);
    expect(fetched).toBe(true);
    expect(res.cacheHit).toBe(false);
  });
});

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
