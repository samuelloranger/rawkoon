export interface JellyfinIntegrationConfig {
  api_key: string;
  website_url: string;
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

export interface LocalAiConfig {
  base_url: string;
  model: string;
}

export interface GoogleBooksIntegrationConfig {
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
