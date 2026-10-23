import type { AiFeatureToggles } from "@rawkoon/shared/types";
export interface JellyfinIntegrationConfig {
  api_key: string;
  website_url: string;
  /** Shows the Jellyfin option on login and enables the sign-in endpoint and sync. */
  sign_in_enabled: boolean;
  /** Any enabled Jellyfin user may sign in; only effective with sign_in_enabled. */
  open_sign_in: boolean;
}

export interface RadarrIntegrationConfig {
  api_key: string;
  website_url: string;
  root_folder_path: string;
  quality_profile_id: number;
}

export interface SonarrIntegrationConfig {
  api_key: string;
  website_url: string;
  root_folder_path: string;
  quality_profile_id: number;
  language_profile_id: number;
}

/** Shared config shape for indexer managers (Prowlarr, Jackett). */
export interface IndexerIntegrationConfig {
  api_key: string;
  website_url: string;
  rss_indexers: string[];
}

/** @deprecated Use IndexerIntegrationConfig — kept as alias for existing references. */
export type ProwlarrIntegrationConfig = IndexerIntegrationConfig;

export interface TmdbIntegrationConfig {
  api_key: string;
  popularity_threshold: number;
}

export interface FanartIntegrationConfig {
  api_key: string;
}

export interface AiProviderConfig {
  base_url: string;
  model: string;
  /** Speech-to-text model for book_sync; callers fall back to a default when absent. */
  transcription_model?: string;
  /** Optional: local servers need no auth, hosted OpenAI-compatible ones do. */
  api_key?: string;
  /** USD per million tokens; only used to estimate cost at read time. */
  input_price_per_million?: number;
  output_price_per_million?: number;
  /** USD; absent means no budget. Only enforced when a price is set too. */
  daily_budget_usd?: number;
  /** A missing key means enabled. */
  features?: AiFeatureToggles;
}

export interface GoogleBooksIntegrationConfig {
  api_key: string;
}

export interface NytBooksIntegrationConfig {
  api_key: string;
}

/**
 * Audnexus needs no API key: the public instance at api.audnex.us is keyless
 * (verified 2026-08-24 — x-ratelimit-limit 300 per 60s per IP). base_url exists
 * so a self-hosted instance can be pointed at instead; the project publishes no
 * prebuilt image, so self-hosting means building from source.
 */
export interface AudnexusIntegrationConfig {
  base_url: string;
  region: string;
}
