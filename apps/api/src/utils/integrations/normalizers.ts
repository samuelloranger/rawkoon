import type {
  JellyfinIntegrationConfig,
  IndexerIntegrationConfig,
  ProwlarrIntegrationConfig,
  RadarrIntegrationConfig,
  SonarrIntegrationConfig,
  TmdbIntegrationConfig,
  LocalAiConfig,
} from "./types";
import { decrypt } from "@rawkoon/api/services/crypto";

const normalizeSecret = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    return decrypt(trimmed).trim();
  } catch (error) {
    // A stored secret failed to decrypt (SECRET_KEY likely changed). Fail
    // closed: return empty so the integration normalizes to null and shows as
    // unconfigured, instead of using ciphertext as the key and failing silently.
    console.error(
      `[integrations] failed to decrypt a stored secret — integration will be treated as unconfigured until re-saved: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return "";
  }
};

export const normalizeJellyfinConfig = (
  config: unknown,
): JellyfinIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;

  const apiKey = normalizeSecret(cfg.api_key);
  const websiteUrl =
    typeof cfg.website_url === "string" ? cfg.website_url.trim() : "";

  if (!apiKey || !websiteUrl) return null;
  return {
    api_key: apiKey,
    website_url: websiteUrl.replace(/\/+$/, ""),
  };
};

export const normalizeRadarrConfig = (
  config: unknown,
): RadarrIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;

  const apiKey = normalizeSecret(cfg.api_key);
  const websiteUrl =
    typeof cfg.website_url === "string" ? cfg.website_url.trim() : "";
  const rootFolderPath =
    typeof cfg.root_folder_path === "string" ? cfg.root_folder_path.trim() : "";
  const qualityProfileId =
    typeof cfg.quality_profile_id === "number"
      ? Math.trunc(cfg.quality_profile_id)
      : typeof cfg.quality_profile_id === "string"
        ? parseInt(cfg.quality_profile_id, 10)
        : Number.NaN;

  if (
    !apiKey ||
    !websiteUrl ||
    !rootFolderPath ||
    !Number.isFinite(qualityProfileId) ||
    qualityProfileId <= 0
  ) {
    return null;
  }

  return {
    api_key: apiKey,
    website_url: websiteUrl.replace(/\/+$/, ""),
    root_folder_path: rootFolderPath,
    quality_profile_id: qualityProfileId,
  };
};

export const normalizeSonarrConfig = (
  config: unknown,
): SonarrIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;

  const apiKey = normalizeSecret(cfg.api_key);
  const websiteUrl =
    typeof cfg.website_url === "string" ? cfg.website_url.trim() : "";
  const rootFolderPath =
    typeof cfg.root_folder_path === "string" ? cfg.root_folder_path.trim() : "";
  const qualityProfileId =
    typeof cfg.quality_profile_id === "number"
      ? Math.trunc(cfg.quality_profile_id)
      : typeof cfg.quality_profile_id === "string"
        ? parseInt(cfg.quality_profile_id, 10)
        : Number.NaN;
  const languageProfileId =
    typeof cfg.language_profile_id === "number"
      ? Math.trunc(cfg.language_profile_id)
      : typeof cfg.language_profile_id === "string"
        ? parseInt(cfg.language_profile_id, 10)
        : Number.NaN;

  if (
    !apiKey ||
    !websiteUrl ||
    !rootFolderPath ||
    !Number.isFinite(qualityProfileId) ||
    qualityProfileId <= 0 ||
    !Number.isFinite(languageProfileId) ||
    languageProfileId <= 0
  ) {
    return null;
  }

  return {
    api_key: apiKey,
    website_url: websiteUrl.replace(/\/+$/, ""),
    root_folder_path: rootFolderPath,
    quality_profile_id: qualityProfileId,
    language_profile_id: languageProfileId,
  };
};

const normalizeIndexerConfig = (
  config: unknown,
): IndexerIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;

  const apiKey = normalizeSecret(cfg.api_key);
  const websiteUrl =
    typeof cfg.website_url === "string" ? cfg.website_url.trim() : "";

  if (!apiKey || !websiteUrl) return null;
  return {
    api_key: apiKey,
    website_url: websiteUrl.replace(/\/+$/, ""),
    rss_indexers: Array.isArray(cfg.rss_indexers)
      ? (cfg.rss_indexers as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
  };
};

export const normalizeProwlarrConfig = (
  config: unknown,
): ProwlarrIntegrationConfig | null => normalizeIndexerConfig(config);

export const normalizeJackettConfig = (
  config: unknown,
): IndexerIntegrationConfig | null => normalizeIndexerConfig(config);

const DEFAULT_TMDB_POPULARITY_THRESHOLD = 15;

export const normalizeTmdbConfig = (
  config: unknown,
): TmdbIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;
  const apiKey = normalizeSecret(cfg.api_key);
  if (!apiKey) return null;
  const rawThreshold =
    typeof cfg.popularity_threshold === "number"
      ? cfg.popularity_threshold
      : DEFAULT_TMDB_POPULARITY_THRESHOLD;
  const popularityThreshold = Math.max(
    0,
    Math.min(100, Math.round(rawThreshold)),
  );
  return {
    api_key: apiKey,
    popularity_threshold: popularityThreshold,
  };
};

export const normalizeLocalAiConfig = (
  config: unknown,
): LocalAiConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;
  if (typeof cfg.base_url !== "string" || !cfg.base_url) return null;
  if (typeof cfg.model !== "string" || !cfg.model) return null;
  return { base_url: cfg.base_url.replace(/\/+$/, ""), model: cfg.model };
};
