import { describe, it, expect } from "bun:test";
import {
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
