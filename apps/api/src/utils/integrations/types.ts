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
