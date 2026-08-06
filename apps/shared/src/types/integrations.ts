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

export type DownloadClientType = "qbittorrent" | "transmission" | "deluge";

export interface DownloadClientIntegration {
  type: "download-client";
  enabled: boolean;
  client_type: DownloadClientType;
  website_url: string;
  username: string;
  password_set: boolean;
  label: string;
  save_path?: string;
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

export interface DownloadClientIntegrationUpdateResponse {
  success: boolean;
  integration: DownloadClientIntegration;
}

export type DownloadClientHookStatus =
  | "not-configured" // no callback URL set
  | "awaiting-first" // configured, nothing received yet
  | "active" // hook seen within 24h
  | "stale" // seen, but not for over 24h
  | "foreign-program"; // qBittorrent autorun belongs to the user

export type DownloadClientHookConfig = {
  status: DownloadClientHookStatus;
  callbackUrl: string | null;
  autoConfigure: boolean;
  lastSeenAt: string | null;
  activeHookedSecs: number;
  token: string;
  qbittorrentCommand: string;
  delugeScript: string;
  transmissionScript: string;
};

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
