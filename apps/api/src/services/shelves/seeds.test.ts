import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("@rawkoon/api/db", () => ({ prisma: {} }));
mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => ({
  getLibraryTmdbApiKey: async () => "test-key",
  tmdbApiFetch: async () => ({}),
}));

const { findSeed, listSeeds } = await import("./seeds");

const urls: string[] = [];
const originalFetch = globalThis.fetch;

const reply = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

function mockTmdb() {
  urls.length = 0;
  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    if (url.includes("/collection/")) {
      return reply({
        id: 645,
        name: "James Bond Collection",
        overview: "",
        poster_path: null,
        backdrop_path: null,
        parts: [
          {
            id: 646,
            title: "Dr. No",
            release_date: "1962-10-07",
            poster_path: "/drno.jpg",
            overview: null,
            vote_average: 7,
          },
          {
            id: 657,
            title: "From Russia with Love",
            release_date: "1963-10-11",
            poster_path: "/frwl.jpg",
            overview: null,
            vote_average: 7,
          },
        ],
      });
    }
    if (url.includes("/discover/")) {
      return reply({
        page: 1,
        total_pages: 1,
        results: [
          {
            id: 1,
            title: "A Christmas Film",
            release_date: "1999-12-24",
            poster_path: "/christmas.jpg",
            popularity: 10,
          },
          {
            id: 2,
            title: "Another Christmas Film",
            release_date: "2004-12-24",
            poster_path: null,
            popularity: 9,
          },
        ],
      });
    }
    return reply({});
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("shelf seeds", () => {
  it("ships the starter recipes with english and french names", () => {
    const seeds = listSeeds();
    expect(seeds.map((seed) => seed.key)).toEqual([
      "christmas",
      "disney",
      "pixar",
      "ghibli",
      "bond",
      "mcu",
      "real_horror",
      "cozy_sunday",
    ]);
    const christmas = findSeed("christmas");
    expect(christmas?.name.en).toBe("Christmas movies");
    expect(christmas?.name.fr).toBe("Films de Noël");
    expect(christmas?.visibleFrom).toBe("11-01");
    expect(christmas?.visibleTo).toBe("01-15");
    expect(christmas?.homeRow).toBe(true);
  });

  it("ships Real horror with rules and auto-join off, and Cozy Sunday empty", () => {
    const horror = findSeed("real_horror");
    expect(horror?.name.fr).toBe("Vraie horreur");
    expect(horror?.rules).toEqual({
      genres_any: [27],
      genres_none: [35, 10751, 16],
      keywords_none: [11931, 9755, 379671],
      votes_min: 300,
    });
    expect(horror?.needsTmdb).toBe(false);
    const cozy = findSeed("cozy_sunday");
    expect(cozy?.name.en).toBe("Cozy Sunday");
    expect(cozy?.rules).toBeUndefined();
    expect(cozy?.allowEmpty).toBe(true);
  });

  it("loads christmas from TMDB discover with the verified keyword and votes", async () => {
    mockTmdb();
    const entries = (await findSeed("christmas")?.load("test-key")) ?? [];
    expect(urls[0]).toContain("discover/movie");
    expect(urls[0]).toContain("with_keywords=207317");
    expect(urls[0]).toContain("vote_count.gte=100");
    expect(urls[0]).toContain("sort_by=popularity.desc");
    expect(urls[0]).toContain("language=en-US");
    expect(entries.map((entry) => entry.title)).toEqual([
      "A Christmas Film",
      "Another Christmas Film",
    ]);
    expect(entries[0]).toMatchObject({
      tmdbId: 1,
      type: "movie",
      year: 1999,
      posterPath: "/christmas.jpg",
      season: null,
      groupLabel: null,
    });
  });

  it("loads disney from both company ids", async () => {
    mockTmdb();
    await findSeed("disney")?.load("test-key");
    expect(urls[0]).toContain("with_companies=2%7C6125");
    expect(urls[0]).toContain("vote_count.gte=100");
  });

  it("loads pixar and ghibli from their verified company ids", async () => {
    mockTmdb();
    await findSeed("pixar")?.load("test-key");
    expect(urls[0]).toContain("with_companies=3");
    urls.length = 0;
    await findSeed("ghibli")?.load("test-key");
    expect(urls[0]).toContain("with_companies=10342");
  });

  it("loads bond from its collection, keeping the poster path", async () => {
    mockTmdb();
    const entries = (await findSeed("bond")?.load("test-key")) ?? [];
    expect(urls[0]).toContain("collection/645");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      tmdbId: 646,
      title: "Dr. No",
      year: 1962,
      posterPath: "/drno.jpg",
    });
  });

  it("loads the MCU timeline without calling TMDB", async () => {
    mockTmdb();
    const entries = (await findSeed("mcu")?.load("test-key")) ?? [];
    expect(urls).toEqual([]);
    expect(entries.length).toBeGreaterThan(40);
    expect(
      entries.some((entry) => entry.groupLabel === "The Infinity Saga"),
    ).toBe(true);
    const loki = entries.filter((entry) => entry.title === "Loki");
    expect(loki.map((entry) => entry.season).sort()).toEqual([1, 2]);
  });
});
