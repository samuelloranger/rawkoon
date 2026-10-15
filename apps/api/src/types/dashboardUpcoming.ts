export interface ArrIntegrationStatus {
  radarr_enabled: boolean;
  sonarr_enabled: boolean;
}

export interface DashboardUpcomingProvider {
  id: number;
  name: string;
  logo_url: string;
}

export interface DashboardUpcomingItem {
  id: string;
  title: string;
  media_type: "movie" | "tv";
  release_date: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  overview: string | null;
  tmdb_url: string;
  providers: DashboardUpcomingProvider[];
  library_id: number | null;
  season_number: number | null;
  episode_number: number | null;
  /** Last episode when several air the same day in one season; null otherwise. */
  episode_number_end?: number | null;
  /** Episodes this entry stands for (more than one when several air the same day). */
  episode_count?: number;
  vote_average?: number | null;
  popularity?: number;
}
