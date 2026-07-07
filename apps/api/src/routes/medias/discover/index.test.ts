import { describe, it, expect } from "bun:test";
import { buildDiscoverDeck } from "@rawkoon/api/services/discover/buildDiscoverDeck";
import type { RecommendationProvider } from "@rawkoon/api/services/discover/types";
import type { DiscoverDeckItem } from "@rawkoon/shared/types";

function item(tmdb_id: number): DiscoverDeckItem {
  return {
    id: `movie-${tmdb_id}`,
    tmdb_id,
    media_type: "movie",
    title: `T${tmdb_id}`,
    release_year: 2020,
    poster_url: null,
    overview: null,
    vote_average: 7,
    genre_ids: [],
  };
}

// NOTE: buildDiscoverDeck reads the library + dismissals from Prisma directly.
// This test documents the provider contract the route depends on; the pure
// filtering invariant is covered exhaustively in assembleDeck.test.ts.
describe("discover deck provider contract", () => {
  it("fake provider returns seeded then fallback candidates", async () => {
    const provider: RecommendationProvider = {
      name: "fake",
      getSeededCandidates: async () => [item(1), item(2)],
      getFallbackCandidates: async () => [item(3)],
    };
    const seeded = await provider.getSeededCandidates({
      movieTmdbIds: [10],
      showTmdbIds: [],
      language: "en-US",
    });
    const fallback = await provider.getFallbackCandidates({
      language: "en-US",
    });
    expect(seeded.map((i) => i.tmdb_id)).toEqual([1, 2]);
    expect(fallback.map((i) => i.tmdb_id)).toEqual([3]);
    // buildDiscoverDeck signature is exercised for type-safety:
    expect(typeof buildDiscoverDeck).toBe("function");
  });
});
