import type { IndexerManagerType } from "./media";

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
  overview: string | null;
  digital_release_date: string | null;
  quality_profile_id: number | null;
  search_attempts: number;
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

export interface AddToLibraryResponse {
  item: LibraryMedia;
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
  file_operation: MediaFileOperation;
  movie_template: string;
  episode_template: string;
  min_seed_ratio: number;
  post_processing_enabled: boolean;
  default_quality_profile_id: number | null;
  active_indexer_manager: IndexerManagerType | null;
  updated_at: string;
}

export interface MediaPostProcessingSettingsResponse {
  settings: MediaPostProcessingSettings;
}

export interface UpdateMediaPostProcessingSettingsRequest {
  movies_library_path?: string | null;
  shows_library_path?: string | null;
  file_operation?: MediaFileOperation;
  movie_template?: string;
  episode_template?: string;
  min_seed_ratio?: number;
  post_processing_enabled?: boolean;
  default_quality_profile_id?: number | null;
  active_indexer_manager?: IndexerManagerType | null;
}

export interface LibraryScanResponse {
  matched: number;
  unmatched: string[];
}

export interface LibraryDownloadsResponse {
  items: LibraryDownloadHistoryItem[];
}

export interface LibrarySearchResponse {
  grabbed: boolean;
  release_title?: string;
  reason?: string;
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
