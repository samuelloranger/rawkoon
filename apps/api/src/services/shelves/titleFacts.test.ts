import { describe, expect, it, mock } from "bun:test";

mock.module("@rawkoon/api/db", () => ({ prisma: {} }));
mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => ({
  getLibraryTmdbApiKey: async () => "k",
  tmdbApiFetch: async () => ({}),
}));

const { parseTitleFacts } = await import("./titleFacts");

const movie = {
  genres: [{ id: 27, name: "Horror" }],
  keywords: {
    keywords: [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ],
  },
  production_companies: [{ id: 3 }],
  belongs_to_collection: { id: 645 },
  vote_count: 1200,
  vote_average: 7.4,
  release_dates: {
    results: [
      {
        iso_3166_1: "CA",
        release_dates: [
          { certification: "", type: 1 },
          { certification: "14A", type: 4 },
          { certification: "18A", type: 3 },
        ],
      },
      {
        iso_3166_1: "US",
        release_dates: [{ certification: "R", type: 3 }],
      },
    ],
  },
};

const show = {
  genres: [{ id: 18 }, { id: 80 }],
  keywords: { results: [{ id: 9 }] },
  production_companies: [{ id: 7 }],
  networks: [{ id: 49 }, { id: 213 }],
  vote_count: 50,
  vote_average: 8.1,
  content_ratings: {
    results: [
      { iso_3166_1: "US", rating: "TV-MA" },
      { iso_3166_1: "CA", rating: "18+" },
    ],
  },
};

describe("title facts", () => {
  it("reads a movie: keywords key, collection, theatrical rating", () => {
    expect(parseTitleFacts(movie, "movie", "CA")).toEqual({
      genreIds: [27],
      keywordIds: [1, 2],
      companyIds: [3],
      networkIds: [],
      tmdbCollectionId: 645,
      certification: "18A",
      voteCount: 1200,
      voteAverage: 7.4,
    });
  });

  it("reads a show: results key, networks, content rating, no collection", () => {
    expect(parseTitleFacts(show, "show", "CA")).toEqual({
      genreIds: [18, 80],
      keywordIds: [9],
      companyIds: [7],
      networkIds: [49, 213],
      tmdbCollectionId: null,
      certification: "18+",
      voteCount: 50,
      voteAverage: 8.1,
    });
  });

  it("falls back to US when the configured country has no rating", () => {
    expect(parseTitleFacts(movie, "movie", "FR").certification).toBe("R");
    expect(parseTitleFacts(show, "show", "FR").certification).toBe("TV-MA");
  });

  it("takes the first non-empty rating when none is theatrical", () => {
    const raw = {
      release_dates: {
        results: [
          {
            iso_3166_1: "US",
            release_dates: [
              { certification: "", type: 3 },
              { certification: "PG", type: 4 },
            ],
          },
        ],
      },
    };
    expect(parseTitleFacts(raw, "movie", "US").certification).toBe("PG");
  });

  it("survives a sparse payload", () => {
    expect(parseTitleFacts({}, "movie", "US")).toEqual({
      genreIds: [],
      keywordIds: [],
      companyIds: [],
      networkIds: [],
      tmdbCollectionId: null,
      certification: null,
      voteCount: null,
      voteAverage: null,
    });
  });
});
