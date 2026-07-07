import type { DiscoverDeckItem } from "@rawkoon/shared/types";

export interface SeedInput {
  movieTmdbIds: number[];
  showTmdbIds: number[];
  language: string;
}

export interface FallbackInput {
  language: string;
}

/**
 * A source of discovery candidates. TMDB now; a Trakt provider can implement
 * this later without touching assembleDeck, the routes, or the UI.
 */
export interface RecommendationProvider {
  readonly name: string;
  getSeededCandidates(input: SeedInput): Promise<DiscoverDeckItem[]>;
  getFallbackCandidates(input: FallbackInput): Promise<DiscoverDeckItem[]>;
}
