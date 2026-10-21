import type { IndexerManagerType, LanguageFallbackSummary } from "./media";
import type { DownloadSeedState } from "./seeding";

export type LibraryMediaStatus =
  | "wanted"
  | "downloading"
  | "downloaded"
  | "skipped"
  | "returning"
  | "in_production"
  | "planned"
  | "upgrading";

export interface LibraryAudioTrack {
  index: number;
  language: string;
  language_name: string;
  title: string | null;
  codec: string | null;
  channels: number | null;
  channel_layout: string | null;
  bitrate_kbps: number | null;
  default: boolean;
  forced: boolean;
}

export interface LibrarySubtitleTrack {
  index: number;
  language: string;
  language_name: string;
  title: string | null;
  format: string | null;
  forced: boolean;
  hearing_impaired: boolean;
}

export interface LibraryFileInfo {
  id: number;
  file_name: string;
  file_path: string;
  size_bytes: string;
  duration_secs: number | null;
  release_group: string | null;
  video_codec: string | null;
  video_profile: string | null;
  width: number | null;
  height: number | null;
  frame_rate: number | null;
  bit_depth: number | null;
  video_bitrate: number | null;
  hdr_format: string | null;
  resolution: number | null;
  source: string | null;
  audio_tracks: LibraryAudioTrack[];
  subtitle_tracks: LibrarySubtitleTrack[];
  scanned_at: string;
  season: number | null;
  episode: number | null;
  episode_title: string | null;
}

export interface LibraryFilesResponse {
  media_type: "movie" | "show";
  files: LibraryFileInfo[];
}
type LibraryMediaType = "movie" | "show";

interface LibraryQualityProfileRef {
  id: number;
  name: string;
}

export interface LibraryMedia {
  id: number;
  tmdb_id: number;
  type: LibraryMediaType;
  title: string;
  sort_title: string | null;
  year: number | null;
  status: LibraryMediaStatus;
  monitored: boolean;
  poster_url: string | null;
  /** Override-only; there is no stored backdrop column. */
  backdrop_url: string | null;
  overview: string | null;
  original_title: string | null;
  original_language: string | null;
  search_title: string | null;
  search_title_language: string | null;
  digital_release_date: string | null;
  quality_profile_id: number | null;
  search_attempts: number;
  /** Last automatic or manual search; null until one has run. */
  last_search_at: string | null;
  last_search_outcome: SearchOutcome | null;
  last_search_reason: string | null;
  quality_profile: LibraryQualityProfileRef | null;
  needs_upgrade?: boolean;
  affected_episodes?: number;
  added_at: string;
  updated_at: string;
  last_grabbed_at: string | null;
  total_size_bytes: string | null;
  // Technical metadata from best file
  resolution: number | null;
  video_codec: string | null;
  hdr_format: string | null;
  audio_format: string | null;
  duration_secs: number | null;
  language_tags: string[];
  overrides?: Record<string, unknown>;
  // Show-specific
  episode_count: number | null;
  downloaded_episode_count: number | null;
  season_count: number | null;
}

export interface LibraryListResponse {
  items: LibraryMedia[];
  movie_count: number;
  show_count: number;
  has_more: boolean;
}

export interface AddToLibraryRequest {
  tmdb_id: number;
  type: "movie" | "show";
  /** Absent = follow the server-wide search-on-add setting. */
  search_on_add?: boolean;
}

export type SearchSkippedReason =
  | "setting_off"
  | "override_off"
  | "not_released"
  | "not_monitored";

export interface AddToLibraryResponse {
  item: LibraryMedia;
  /** True when a background search for a release was queued by this add. */
  search_queued: boolean;
  /** Why no search was queued; null when queued or when there was nothing to search. */
  search_skipped_reason: SearchSkippedReason | null;
  /** Set when the skip reason is not_released (null = no known date). */
  digital_release_date?: string | null;
}

export interface LibraryItemResponse {
  item: LibraryMedia;
}

interface LibraryEpisode {
  id: number;
  season: number;
  episode: number;
  title: string | null;
  air_date: string | null;
  status: LibraryMediaStatus;
  monitored: boolean;
  tmdb_episode_id: number | null;
  downloaded_at: string | null;
  search_attempts: number;
}

interface LibrarySeasonGroup {
  season: number;
  episodes: LibraryEpisode[];
}

export interface LibraryEpisodesResponse {
  seasons: LibrarySeasonGroup[];
}

export interface MigrateLibraryRequest {
  source: "radarr" | "sonarr" | "both";
  radarr_url?: string;
  radarr_api_key?: string;
  sonarr_url?: string;
  sonarr_api_key?: string;
}

export interface MigrateLibraryEnqueueResponse {
  job_id: string | undefined;
}

export interface MigrateJobProgress {
  phase: "radarr" | "sonarr" | "done";
  current: number;
  total: number;
  current_title: string | null;
  radarr: {
    imported: number;
    already_existed: number;
    skipped: number;
    files_scanned: number;
    errors: number;
  };
  sonarr: {
    imported_shows: number;
    imported_episodes: number;
    imported_files: number;
    files_scanned: number;
    errors: number;
  };
}

export interface MigrateJobResult {
  radarr?: {
    imported: number;
    already_existed: number;
    skipped: number;
    files_scanned: number;
    errors: string[];
  };
  sonarr?: {
    imported_shows: number;
    imported_episodes: number;
    imported_files: number;
    files_scanned: number;
    errors: string[];
  };
}

export interface MigrateJobStatus {
  job_id: string | null;
  state: "waiting" | "active" | "completed" | "failed" | "unknown";
  progress: MigrateJobProgress | null;
  result: MigrateJobResult | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface LibraryDownloadHistoryItem {
  id: number;
  release_title: string;
  indexer: string | null;
  torrent_hash: string | null;
  grabbed_at: string;
  completed_at: string | null;
  failed: boolean;
  fail_reason: string | null;
  episode_id: number | null;
  post_process_error?: string | null;
  post_process_destination_path?: string | null;
  ai_picked?: boolean;
  /** Where this row's torrent stands: seeding, released, or blocklisted. */
  seed?: DownloadSeedState | null;
  live?: {
    progress: number;
    download_speed: number;
    eta_seconds: number | null;
    state: string;
  } | null;
}

type MediaFileOperation = "hardlink" | "move";

export interface MediaPostProcessingSettings {
  movies_library_path: string | null;
  shows_library_path: string | null;
  downloads_path: string | null;
  file_operation: MediaFileOperation;
  movie_template: string;
  episode_template: string;
  min_seed_ratio: number;
  post_processing_enabled: boolean;
  default_movie_quality_profile_id: number | null;
  default_show_quality_profile_id: number | null;
  /** Search for a release right after a movie or show is added. */
  search_on_add: boolean;
  /** 5-field cron for the scheduled movie and episode release checks. */
  release_check_cron: string;
  /** Minutes between indexer RSS polls; one of RSS_POLL_INTERVAL_MINUTES. */
  rss_poll_interval_minutes: number;
  active_indexer_manager: IndexerManagerType | null;
  /** Book fields share this row: post-processing is per instance, not per kind. */
  books_library_path: string | null;
  audiobooks_library_path: string | null;
  book_template: string;
  audiobook_template: string;
  default_book_quality_profile_id: number | null;
  /** Public default = min_seed_ratio + this. Null = no time target. */
  public_seed_time_mins: number | null;
  private_seed_ratio: number | null;
  private_seed_time_mins: number | null;
  /** Off until an admin opts in to automatic torrent release. */
  seed_sweep_enabled: boolean;
  blocked_extensions: string[];
  /** Minimum GB to keep free when grabbing; 0 disables the check. */
  min_free_space_gb: number;
  updated_at: string;
}

export interface MediaPostProcessingSettingsResponse {
  settings: MediaPostProcessingSettings;
}

export interface UpdateMediaPostProcessingSettingsRequest {
  movies_library_path?: string | null;
  shows_library_path?: string | null;
  downloads_path?: string | null;
  file_operation?: MediaFileOperation;
  movie_template?: string;
  episode_template?: string;
  min_seed_ratio?: number;
  post_processing_enabled?: boolean;
  default_movie_quality_profile_id?: number | null;
  default_show_quality_profile_id?: number | null;
  search_on_add?: boolean;
  release_check_cron?: string;
  rss_poll_interval_minutes?: number;
  active_indexer_manager?: IndexerManagerType | null;
  books_library_path?: string | null;
  audiobooks_library_path?: string | null;
  book_template?: string;
  audiobook_template?: string;
  default_book_quality_profile_id?: number | null;
  public_seed_time_mins?: number | null;
  private_seed_ratio?: number | null;
  private_seed_time_mins?: number | null;
  seed_sweep_enabled?: boolean;
  blocked_extensions?: string[];
  min_free_space_gb?: number;
}

export interface LibraryScanResponse {
  matched: number;
  unmatched: string[];
}

export interface LibraryDownloadsResponse {
  items: LibraryDownloadHistoryItem[];
}

/**
 * One row's live progress in a `download-progress` SSE event. Keyed by the
 * `download_history` id so a client merges it onto the row it already has.
 * camelCase because SSE payloads are not snake-cased like REST bodies.
 */
export interface DownloadProgressItem {
  id: number;
  progress: number;
  state: string;
  downloadSpeed: number;
  etaSeconds: number | null;
}

/**
 * A movie or episode that just finished importing, pushed as a `landed` SSE
 * event. `season`/`episode` are null for a movie, `episode` is null for a
 * season pack (which carries `episodeCount`). `ts` is epoch milliseconds.
 */
export interface LandedArrival {
  mediaId: number;
  mediaType: "movie" | "tv";
  title: string;
  posterUrl: string | null;
  season: number | null;
  episode: number | null;
  episodeCount: number | null;
  ts: number;
}

/** Server-pushed live download progress for one library media. */
export interface DownloadProgressEvent {
  kind: "download-progress";
  mediaId: number;
  ts: number;
  downloads: DownloadProgressItem[];
}

export type SearchOutcome =
  | "grabbed"
  | "delayed"
  | "no_match"
  | "not_released"
  | "error";

/** How a finished search (automatic or "Search now") ended. */
export interface SearchResultPayload {
  media_id: number;
  /** Set when the search covered one season of a show. */
  season?: number;
  outcome: SearchOutcome;
  release?: {
    title: string;
    resolution: number | null;
    source: string | null;
    size_bytes: number | null;
  };
  /** ISO time: when a held grab is released, or the digital release for not_released. */
  delay_until?: string;
  /** For a held grab: the pending-release target, used to grab it early. */
  target_key?: string;
  /** Every held target of this search (a show can hold several seasons or episodes). */
  target_keys?: string[];
  reason?: string;
  language_fallback_summary?: LanguageFallbackSummary;
}

/** Pushed on the library SSE stream when a search finishes. `ts` is epoch milliseconds. */
export interface SearchResultEvent extends SearchResultPayload {
  kind: "search_result";
  ts: number;
}

export interface LibrarySearchResponse {
  grabbed: boolean;
  release_title?: string;
  /** True when the AI judge's pick was the release grabbed. */
  ai_picked?: boolean;
  reason?: string;
  /** Set when the miss is because only other versions of the preferred language exist. */
  language_fallback_summary?: LanguageFallbackSummary | null;
  /** The same outcome the library stream pushes, so a client need not wait for it. */
  search_result?: SearchResultPayload;
  /** Set on a failed replace-grab: the running download was already stopped. */
  replaced_previous?: boolean;
}

/** Body of POST /api/library/:id/grab. */
export interface LibraryGrabRequest {
  download_url: string;
  release_title: string;
  indexer?: string;
  quality_parsed?: unknown;
  size_bytes?: number | null;
  episode_id?: number | null;
  season?: number | null;
  is_upgrade?: boolean;
  /** Admin opt-in: stop a movie's running download and grab this release instead. */
  replace?: boolean;
}

interface GlobalDownloadHistoryItem extends LibraryDownloadHistoryItem {
  media_id: number | null;
  media_title: string | null;
  media_type: "movie" | "show" | null;
}

export interface GlobalDownloadHistoryResponse {
  items: GlobalDownloadHistoryItem[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

interface DownloadHistoryTopIndexer {
  name: string;
  count: number;
}

interface DownloadHistoryDayStat {
  date: string;
  count: number;
}

interface DownloadHistoryStats {
  total_grabs: number;
  completed_grabs: number;
  failed_grabs: number;
  active_grabs: number;
  success_rate: number | null;
  top_indexers: DownloadHistoryTopIndexer[];
  grabs_by_day: DownloadHistoryDayStat[];
}

export interface DownloadHistoryStatsResponse {
  stats: DownloadHistoryStats;
}

export type LibraryStatsResolution =
  | "unknown"
  | "480p"
  | "720p"
  | "1080p"
  | "4k";

interface LibraryStatusTypeCount {
  type: "movie" | "show";
  status: string;
  count: number;
}

interface LibraryResolutionStorage {
  resolution: LibraryStatsResolution;
  size_bytes: number;
}

interface LibraryTmdbStatusCount {
  tmdb_status: string;
  count: number;
}

export interface LibraryStats {
  total_movies: number;
  total_shows: number;
  downloaded: number;
  wanted: number;
  returning_series: number;
  storage_used_bytes: number;
  /** Capacity/free of the library volume; null when the path is unset or unreadable. */
  disk_total_bytes: number | null;
  disk_free_bytes: number | null;
  counts_by_status_type: LibraryStatusTypeCount[];
  storage_by_resolution: LibraryResolutionStorage[];
  shows_by_tmdb_status: LibraryTmdbStatusCount[];
}

export type LibraryAttentionKind =
  | "download_failed"
  | "post_process_error"
  | "download_stuck"
  | "grab_skipped"
  | "auto_grab_stalled";

type LibraryAttentionScopeType = "movie" | "episode" | "season_pack";

export interface LibraryAttentionItem {
  id: number;
  kind: LibraryAttentionKind;
  scope_type: LibraryAttentionScopeType;
  media_id: number;
  media_title: string;
  media_type: "movie" | "show";
  episode_id: number | null;
  season: number | null;
  episode_number: number | null;
  detail: string | null;
  search_attempts: number | null;
  library_status: string | null;
  download_history_id: number | null;
  grabbed_at: string | null;
  updated_at: string;
}

export interface LibraryAttentionResponse {
  items: LibraryAttentionItem[];
}

/** Counts of what landed in the library over one window. */
export interface LibraryGrowthBucket {
  /** First day of the window, YYYY-MM-DD in the instance timezone. */
  start: string;
  movies: number;
  episodes: number;
  books: number;
  upgrades: number;
  /** Bytes that landed; null for non-admin users. */
  bytes: number | null;
}

export interface LibraryGrowth {
  timezone: string;
  /** Current calendar month so far. */
  month: LibraryGrowthBucket;
  /** Previous calendar month, day 1 up to the same day-of-month and time. */
  previous_to_date: LibraryGrowthBucket;
  /** The whole previous calendar month. */
  previous_month: LibraryGrowthBucket;
  /** Exactly 12 ISO weeks (Monday start), oldest first, last = current week. */
  weeks: LibraryGrowthBucket[];
  /** Date of the first recorded landing, or null when nothing landed yet. */
  since: string | null;
}

export interface LibraryGrowthResponse {
  growth: LibraryGrowth;
}

export type GrabReadinessStatus = "ok" | "warn" | "error";

export type GrabReadinessCheckId =
  | "indexer_manager"
  | "download_client"
  | "default_movie_profile"
  | "default_show_profile"
  | "rss_indexers"
  | "profiles_without_maximum"
  | "search_on_add";

export interface GrabReadinessCheck {
  id: GrabReadinessCheckId;
  status: GrabReadinessStatus;
  /** Check-specific values the client interpolates into its message and fix. */
  params: Record<string, unknown>;
}

export interface GrabReadinessResponse {
  checks: GrabReadinessCheck[];
}
