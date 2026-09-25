export type TranscodeCodec = "hevc" | "av1";
export type TranscodeEncoder = "software" | "vaapi";
export type TranscodeResolution = "keep" | 1080 | 720;
export type TranscodeMode = "quality" | "target";
export type TranscodePreset = "high" | "balanced" | "small";
export type TranscodeSpeed = "slower" | "default" | "faster";

export interface TranscodeJobSettings {
  codec: TranscodeCodec;
  encoder: TranscodeEncoder;
  resolution: TranscodeResolution;
  mode: TranscodeMode;
  preset: TranscodePreset;
  /** Advanced override: CRF (software) or QP (VAAPI). */
  quality?: number;
  speed: TranscodeSpeed;
  /** Target mode only: video bitrate applied to every file of the batch. */
  targetVideoKbps?: number;
  convertLosslessAudio: boolean;
}

export type TranscodeJobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";
export type TranscodeStep =
  | "preflight"
  | "encode"
  | "validate"
  | "replace"
  | "rescan";

export interface TranscodeCombo {
  codec: TranscodeCodec;
  encoder: TranscodeEncoder;
}

export interface TranscodeCapabilities {
  combos: TranscodeCombo[];
  device_label: string | null;
  /** Why VAAPI is unavailable, when it is. */
  vaapi_unavailable_reason: string | null;
}

export interface TranscodeSelection {
  file_ids?: number[];
  media_id?: number;
  season?: number;
}

export interface TranscodeEstimateFile {
  file_id: number;
  title: string;
  source_bytes: string;
  estimated_bytes: string;
  nlink: number;
  duration_secs: number;
}

export interface TranscodeExcludedFile {
  file_id: number;
  title: string;
  reason: string;
}

export type TranscodeEstimateSource = "rough" | "refined" | "target";

export interface TranscodeEstimate {
  files: TranscodeEstimateFile[];
  excluded: TranscodeExcludedFile[];
  total_source_bytes: string;
  total_estimated_bytes: string;
  total_duration_secs: number;
  /** Bytes of audio after conversion, summed; lets the client derive a target bitrate. */
  total_audio_bytes: string;
  range_pct: number;
  frees_now_bytes: string;
  frees_after_seeding_bytes: string;
  /** Extra disk used until seeding copies are removed. */
  temporary_growth_bytes: string;
  eta_secs: number;
  source: TranscodeEstimateSource;
  refined_files: number;
  refined_clips: number;
  /** Lossless audio tracks that the convert toggle would change, first file only. */
  audio_changes: { label: string; to: string }[];
  source_height: number | null;
}

export interface TranscodeLiveProgress {
  progress: number;
  fps: number | null;
  speed: number | null;
  eta_secs: number | null;
  current_bytes: string | null;
}

export interface TranscodeJob {
  id: number;
  media_file_id: number | null;
  media_id: number | null;
  batch_id: string;
  title: string;
  position: number;
  status: TranscodeJobStatus;
  step: TranscodeStep | null;
  settings: TranscodeJobSettings;
  source_bytes: string;
  estimated_bytes: string | null;
  output_bytes: string | null;
  source_nlink: number | null;
  progress: number | null;
  ssim_avg: number | null;
  ssim_min: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  poster_url: string | null;
  live: TranscodeLiveProgress | null;
}

export interface TranscodeQueueSettings {
  paused: boolean;
  window_enabled: boolean;
  window_start: string;
  window_end: string;
  ssim_threshold: number;
  ssim_clip_min: number;
  cpu_threads: number | null;
}

export type TranscodeQueueState =
  | "running"
  | "paused"
  | "waiting_window"
  | "idle";

export interface TranscodeSummary {
  show: boolean;
  state: TranscodeQueueState;
  window_start: string;
  current: TranscodeJob | null;
  next: TranscodeJob[];
  queued_count: number;
  queued_source_bytes: string;
  queued_eta_secs: number;
  saved_bytes_30d: string;
  done_count_30d: number;
  frees_after_seeding_bytes: string;
  failed_count: number;
}

export interface TranscodeJobsResponse {
  jobs: TranscodeJob[];
}
