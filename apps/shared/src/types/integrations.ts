export interface ArrProfile {
  id: number;
  name: string;
}

export interface JellyfinIntegration {
  type: "jellyfin";
  enabled: boolean;
  website_url: string;
  api_key: string;
}

export interface ProwlarrIntegration {
  type: "prowlarr";
  enabled: boolean;
  website_url: string;
  api_key: string;
  rss_indexers: string[];
}

export interface JackettIntegration {
  type: "jackett";
  enabled: boolean;
  website_url: string;
  api_key: string;
  rss_indexers: string[];
}

export interface QbittorrentIntegration {
  type: "qbittorrent";
  enabled: boolean;
  website_url: string;
  username: string;
  password_set: boolean;
  rawkoon_base_url?: string;
  webhook_secret_configured?: boolean;
}

export interface TmdbIntegration {
  type: "tmdb";
  enabled: boolean;
  api_key: string;
  popularity_threshold: number;
}

export interface JellyfinIntegrationUpdateResponse {
  success: boolean;
  integration: JellyfinIntegration;
  queued?: boolean;
  message?: string;
}

export interface ProwlarrIntegrationUpdateResponse {
  success: boolean;
  integration: ProwlarrIntegration;
}

export interface JackettIntegrationUpdateResponse {
  success: boolean;
  integration: JackettIntegration;
}

export interface QbittorrentIntegrationUpdateResponse {
  success: boolean;
  integration: QbittorrentIntegration;
}

export interface TmdbIntegrationUpdateResponse {
  success: boolean;
  integration: TmdbIntegration;
}

export interface OidcProvider {
  id: string;
  slug: string;
  name: string;
  discovery_url: string;
  client_id: string;
  client_secret_set: boolean;
  enabled: boolean;
  icon_url: string | null;
}

export interface LocalAiIntegration {
  type: "local-ai";
  enabled: boolean;
  base_url: string;
  model: string;
}

export interface LocalAiIntegrationUpdateResponse {
  success: boolean;
  integration: LocalAiIntegration;
}
