type ActivityType =
  | "task_completed"
  | "integration_updated"
  | "cron_job_ended"
  | "cron_job_skipped"
  | "app_updated"
  | "admin_triggered_job"
  | "media_grab"
  | "media_deleted"
  | "book_deleted"
  | (string & {});

export interface Activity {
  id?: number;
  user_id?: string;
  completed_at?: string;
  task_name?: string;
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
  book_id?: number;
  tmdb_id?: number;
  media_type?: string;
  title?: string;
  year?: number;
  delete_files?: boolean;
  release_torrents?: boolean;
  files_removed?: number;
  torrents_released?: number;
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
  /** Last episode when several air the same day in one season; null otherwise. */
  episode_number_end?: number | null;
  /** Episodes this entry stands for (more than one when several air the same day). */
  episode_count?: number;
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
  /** Grabs where AI Provider chose the release (RSS auto-grab only). */
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

/** Subscription URLs for the per-user iCal feed of library release dates. */
export interface CalendarSubscription {
  url: string;
  webcal_url: string;
}

export type DashboardHeroSource = "arrivals" | "for_you" | "trending";

export interface DashboardHeroItem {
  /** Why this slide is here: arrivals come first, deck picks fill the rest. */
  source: DashboardHeroSource;
  /** Null for picks that are not in the library yet. */
  library_id: number | null;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  overview: string | null;
  backdrop_url: string;
  poster_url: string | null;
  /** When the newest import finished; null for non-arrivals. */
  arrived_at: string | null;
  season_number: number | null;
  episode_number: number | null;
  year: number | null;
}

export interface DashboardHeroResponse {
  items: DashboardHeroItem[];
}

export interface DashboardPipelineDownloadItem {
  /** download_history id; matches `DownloadProgressItem.id` in the live SSE feed. */
  id: number;
  library_media_id: number | null;
  book_id: number | null;
  title: string;
  /** 0..1 */
  progress: number;
  eta_seconds: number | null;
}

/**
 * Every block carries `available`: false means its source failed and the other
 * fields are placeholders, so clients show "Couldn't check", not an idle row.
 */
export interface DashboardPipeline {
  downloading: {
    available: boolean;
    count: number;
    speed_bytes_per_sec: number;
    /** The first three in-flight grabs, oldest first. */
    items: DashboardPipelineDownloadItem[];
  };
  /** Titles whose grab is waiting out the grab delay. */
  delayed: { available: boolean; count: number };
  attention: {
    available: boolean;
    /** alerts + gave_up */
    count: number;
    /** Open attention alerts (a true count). */
    alerts: number;
    /** Wanted titles whose last search found nothing or errored, not already in an alert. */
    gave_up: number;
  };
  rss: {
    available: boolean;
    last_run_at: string | null;
    ok: boolean | null;
    releases_found: number | null;
    next_run_at: string | null;
  };
  reencode: { available: boolean; active: number; queued: number };
}
