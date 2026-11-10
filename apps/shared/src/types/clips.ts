// Preview clips: one short silent MP4 per movie and per regular season.
// Admin endpoints live under /api/clips; the TV-facing pair is /api/clips/status and /api/clips/file.

export type ClipKind = "movie" | "season";
type ClipStatus = "queued" | "running" | "done" | "failed";

export interface ClipSettings {
  enabled: boolean;
  paused: boolean;
}

export interface ClipSettingsPatch {
  enabled?: boolean;
  paused?: boolean;
}

/** TV-facing: whether the server generates and serves clips. */
export interface ClipStatusResponse {
  enabled: boolean;
}

export interface ClipSummary {
  id: number;
  kind: ClipKind;
  media_id: number;
  /** 0 for movies. */
  season_number: number;
  status: ClipStatus;
  /** Seconds into the source the clip starts; null until the first cut. */
  start_sec: number | null;
  manual_start: boolean;
  /** Published file size; null when no file exists yet. */
  bytes: number | null;
  error: string | null;
  updated_at: string;
}

interface ClipRunningItem {
  clip_id: number;
  kind: ClipKind;
  title: string;
  /** Null for movies. */
  season_number: number | null;
}

export interface ClipFailedItem {
  clip_id: number;
  kind: ClipKind;
  title: string;
  season_number: number | null;
  error: string | null;
}

export interface ClipProgress {
  settings: ClipSettings;
  done: number;
  /** Queued plus running. */
  left: number;
  failed: number;
  total_bytes: number;
  running: ClipRunningItem | null;
  /** Seconds, from the recent average cut time; null until a clip has finished. */
  eta_seconds: number | null;
  /** Up to 20 most recent failures. */
  failed_items: ClipFailedItem[];
}

export interface ClipRecutRequest {
  start_sec: number;
}

export interface ClipRetryResponse {
  retried: number;
}

export interface ClipDeleteAllResponse {
  deleted_files: number;
  freed_bytes: number;
}
