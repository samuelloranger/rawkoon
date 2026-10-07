export const AI_FEATURES = [
  "release_pick_rss",
  "release_pick_interactive",
  "release_pick_search",
  "book_release_pick",
] as const;

export type AiFeature = (typeof AI_FEATURES)[number];

export type AiTrigger =
  | "rss"
  | "scheduled"
  | "upgrade"
  | "interactive"
  | "manual_search";

export const AI_CALL_STATUSES = [
  "ok",
  "invalid_pick",
  "rate_limited",
  "error",
] as const;

export type AiCallStatus = (typeof AI_CALL_STATUSES)[number];

export const AI_STATS_PERIODS = [7, 30, 90, 365] as const;

export type AiStatsPeriod = (typeof AI_STATS_PERIODS)[number];

export interface AiUsageMetrics {
  calls: number;
  ok: number;
  invalid_pick: number;
  rate_limited: number;
  error: number;
  /** Calls where the AI pick was compared with the classic scorer's. */
  agreement_checked: number;
  /** 0..1 share of compared picks that matched classic; null when none compared. */
  agreement_rate: number | null;
  /** 0..1; 0 when there are no calls. */
  success_rate: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  avg_duration_ms: number | null;
  p50_duration_ms: number | null;
  p95_duration_ms: number | null;
  /** USD; null when no prices are configured. */
  estimated_cost: number | null;
}

interface AiFeatureStats extends AiUsageMetrics {
  feature: string;
}

interface AiTriggerStats extends AiUsageMetrics {
  /** null = calls recorded without a trigger. */
  trigger: string | null;
}

interface AiModelStats extends AiUsageMetrics {
  model: string;
}

export interface AiDailyStats {
  /** YYYY-MM-DD (UTC). */
  date: string;
  calls: number;
  /** Invalid picks plus hard errors. */
  errors: number;
  rate_limited: number;
  total_tokens: number;
  estimated_cost: number | null;
}

export interface AiGrabOutcome {
  total: number;
  completed: number;
  failed: number;
  active: number;
}

export interface AiStatsResponse {
  days: number;
  totals: AiUsageMetrics;
  by_feature: AiFeatureStats[];
  by_model: AiModelStats[];
  by_trigger: AiTriggerStats[];
  daily: AiDailyStats[];
  grabs: {
    ai: AiGrabOutcome;
    classic: AiGrabOutcome;
  };
  prices_configured: boolean;
}

export interface AiCallEntry {
  id: number;
  feature: string;
  model: string;
  structured: boolean;
  status: AiCallStatus;
  trigger: string | null;
  classic_title: string | null;
  agreed_with_classic: boolean | null;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number;
  estimated_cost: number | null;
  media_id: number | null;
  media_title: string | null;
  media_type: string | null;
  book_id: number | null;
  book_edition_id: number | null;
  book_title: string | null;
  picked_title: string | null;
  reasoning: string | null;
  created_at: string;
}

export interface AiCallsResponse {
  calls: AiCallEntry[];
  total: number;
  page: number;
  page_size: number;
}
