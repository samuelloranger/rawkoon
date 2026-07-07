type ActivityType =
  | "task_completed"
  | "integration_updated"
  | "cron_job_ended"
  | "cron_job_skipped"
  | "app_updated"
  | "admin_triggered_job"
  | "media_grab"
  | (string & {});

export interface Activity {
  id?: number;
  user_id?: string;
  task_type?: string;
  task_id?: number;
  completed_at?: string;
  task_name?: string;
  emotion?: string | null;
  username?: string;
  description?: string;
  time?: string;
  icon?: string;
  type?: ActivityType;
  service?: string;
  integration_type?: string;
  job_id?: string;
  job_name?: string;
  action?: string;
  success?: boolean;
  duration_ms?: number;
  message?: string;
  trigger?: string;
  reason?: string;
  from_version?: string;
  to_version?: string;
  event_id?: number;
  event_title?: string;
  item_name?: string;
  count?: number;
  media_id?: number;
  episode_id?: number;
  release_title?: string;
  grab_source?: string;
  ai_picked?: boolean;
}

export interface DashboardActivityFeedResponse {
  activities: Activity[];
  available_services: string[];
  available_types: string[];
  total: number;
  limit: number;
  has_more: boolean;
}

export interface DashboardJellyfinNowPlayingItem {
  session_id: string;
  user: string;
  device: string | null;
  title: string;
  poster_url: string | null;
  progress_pct: number;
  paused: boolean;
}

export interface DashboardJellyfinNowPlayingResponse {
  enabled: boolean;
  sessions: DashboardJellyfinNowPlayingItem[];
}

export interface DashboardUpcomingItem {
  id: string;
  title: string;
  media_type: "movie" | "tv";
  release_date: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  overview: string | null;
  tmdb_url: string | null;
  providers: DashboardUpcomingProvider[];
  library_id: number | null;
  season_number: number | null;
  episode_number: number | null;
  vote_average?: number | null;
  popularity?: number;
}

interface DashboardUpcomingProvider {
  id: number;
  name: string;
  logo_url: string;
}

export interface DashboardUpcomingResponse {
  enabled: boolean;
  items: DashboardUpcomingItem[];
}

interface RssIndexerStat {
  name: string;
  releases_found: number;
}

interface RssRunResult {
  status: "success" | "error";
  started_at: string;
  completed_at: string;
  releases_found: number;
  releases_grabbed: number;
  /** Grabs where Local AI chose the release (RSS auto-grab only). */
  releases_grabbed_by_ai: number;
  indexers: RssIndexerStat[];
  error: string | null;
}

export interface RssStatusResponse {
  /** Server clock (ISO) — align client-relative math so wrong OS time does not skew RSS UI */
  server_time: string;
  last_run: RssRunResult | null;
  history: RssRunResult[];
  next_run_at: string | null;
}
