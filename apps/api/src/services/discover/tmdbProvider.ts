import type { DiscoverDeckItem } from "@rawkoon/shared/types";
import {
  fetchTmdbResults,
  injectMediaType,
  shuffle,
} from "@rawkoon/api/routes/medias/tmdb/tmdbRouteHelpers";
import { mapTmdbSearchItem, toRecord } from "@rawkoon/api/utils/medias/mappers";
import type { FallbackInput, RecommendationProvider, SeedInput } from "./types";

const MOVIE_SEED_SAMPLE = 5;
const SHOW_SEED_SAMPLE = 4;
/** Pages of each trending/popular list to pull so the deck doesn't drain in a few batches. */
const FALLBACK_PAGES = 3;

/** Maps a raw TMDB row (with media_type injected) to a deck item, keeping genre_ids. */
export function toDeckItem(raw: unknown): DiscoverDeckItem | null {
  const base = mapTmdbSearchItem(raw);
  if (!base) return null;
  const row = toRecord(raw);
  const rawGenres = row?.genre_ids;
  const genre_ids = Array.isArray(rawGenres)
    ? rawGenres.filter((g): g is number => typeof g === "number")
    : [];
  // mapTmdbSearchItem truncates vote_average (Math.trunc) — read the raw float
  // so the card can show one decimal (e.g. 8.1, not 8.0).
  const rawVote = row?.vote_average;
  const vote_average =
    typeof rawVote === "number" && rawVote > 0 ? rawVote : null;
  return {
    id: base.id,
    tmdb_id: base.tmdb_id,
    media_type: base.media_type,
    title: base.title,
    release_year: base.release_year,
    poster_url: base.poster_url,
    overview: base.overview,
    vote_average,
    genre_ids,
  };
}

function toDeckItems(rows: unknown[]): DiscoverDeckItem[] {
  return rows.map(toDeckItem).filter((i): i is DiscoverDeckItem => i !== null);
}

export class TmdbProvider implements RecommendationProvider {
  readonly name = "tmdb";
  constructor(private readonly apiKey: string) {}

  async getSeededCandidates(input: SeedInput): Promise<DiscoverDeckItem[]> {
    const movieIds = shuffle(input.movieTmdbIds).slice(0, MOVIE_SEED_SAMPLE);
    const showIds = shuffle(input.showTmdbIds).slice(0, SHOW_SEED_SAMPLE);

    const batches = await Promise.all([
      ...movieIds.map((id) =>
        fetchTmdbResults(
          this.apiKey,
          `movie/${id}/recommendations`,
          input.language,
        )
          .then(injectMediaType("movie"))
          .catch(() => [] as unknown[]),
      ),
      ...showIds.map((id) =>
        fetchTmdbResults(
          this.apiKey,
          `tv/${id}/recommendations`,
          input.language,
        )
          .then(injectMediaType("tv"))
          .catch(() => [] as unknown[]),
      ),
    ]);

    return toDeckItems(batches.flat());
  }

  async getFallbackCandidates(
    input: FallbackInput,
  ): Promise<DiscoverDeckItem[]> {
    const pages = Array.from({ length: FALLBACK_PAGES }, (_, i) =>
      String(i + 1),
    );
    const batches = await Promise.all(
      pages.flatMap((page) => [
        fetchTmdbResults(this.apiKey, "trending/all/day", input.language, {
          page,
        }).catch(() => [] as unknown[]),
        fetchTmdbResults(this.apiKey, "movie/popular", input.language, { page })
          .then(injectMediaType("movie"))
          .catch(() => [] as unknown[]),
        fetchTmdbResults(this.apiKey, "tv/popular", input.language, { page })
          .then(injectMediaType("tv"))
          .catch(() => [] as unknown[]),
      ]),
    );

    return toDeckItems(batches.flat());
  }
}
