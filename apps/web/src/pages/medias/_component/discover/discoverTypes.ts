export interface DiscoverFilters {
  mediaType: "movie" | "tv";
  providerId: number | null;
  genreId: number | null;
  sortBy: string;
  page: number;
  originalLanguage: string | null;
}

export type SortOpt = {
  value: string;
  labelKey: string;
  movieOnly?: true;
  tvOnly?: true;
};
