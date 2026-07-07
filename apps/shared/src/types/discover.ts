export type DiscoverDeckSource = "personalized" | "trending";

export interface DiscoverDeckItem {
  /** `${media_type}-${tmdb_id}` */
  id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  release_year: number | null;
  poster_url: string | null;
  overview: string | null;
  vote_average: number | null;
  genre_ids: number[];
}

export interface DiscoverDeckResponse {
  items: DiscoverDeckItem[];
  source: DiscoverDeckSource;
}

export interface DiscoverDismissRequest {
  tmdb_id: number;
  type: "movie" | "tv";
}
