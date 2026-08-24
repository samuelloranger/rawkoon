import type {
  JellyfinIntegrationConfig,
  IndexerIntegrationConfig,
  ProwlarrIntegrationConfig,
  RadarrIntegrationConfig,
  SonarrIntegrationConfig,
  TmdbIntegrationConfig,
  LocalAiConfig,
  GoogleBooksIntegrationConfig,
  AudnexusIntegrationConfig,
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

/**
 * Google Books is the sole book metadata provider. A key is mandatory:
 * keyless requests hit a shared anonymous quota that is permanently
 * exhausted (measured HTTP 429), so an unkeyed integration is useless
 * rather than degraded.
 */
export const normalizeGoogleBooksConfig = (
  config: unknown,
): GoogleBooksIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;
  const apiKey = normalizeSecret(cfg.api_key);
  if (!apiKey) return null;
  return { api_key: apiKey };
};

export const AUDNEXUS_DEFAULT_BASE_URL = "https://api.audnex.us";
export const AUDNEXUS_DEFAULT_REGION = "us";

/**
 * Regions Audnexus accepts. Kept local rather than imported from
 * services/books/audibleCatalog: this is a util, and pointing it at a service
 * would invert the dependency direction for a ten-entry constant.
 */
const AUDNEXUS_REGIONS = new Set([
  "au",
  "br",
  "ca",
  "de",
  "es",
  "fr",
  "in",
  "it",
  "jp",
  "uk",
  "us",
]);

/**
 * Unlike Google Books there is no key to validate, so an empty config is
 * legitimate and normalizes to the public instance. Only a malformed or
 * non-http base URL yields null, because that is the one thing that would make
 * every request fail in a way the operator cannot see.
 */
export const normalizeAudnexusConfig = (
  config: unknown,
): AudnexusIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const cfg = config as Record<string, unknown>;

  let baseUrl = AUDNEXUS_DEFAULT_BASE_URL;
  const rawUrl = typeof cfg.base_url === "string" ? cfg.base_url.trim() : "";
  if (rawUrl) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    baseUrl = rawUrl.replace(/\/+$/u, "");
  }

  const rawRegion =
    typeof cfg.region === "string" ? cfg.region.trim().toLowerCase() : "";
  const region = AUDNEXUS_REGIONS.has(rawRegion)
    ? rawRegion
    : AUDNEXUS_DEFAULT_REGION;

  return { base_url: baseUrl, region };
};
