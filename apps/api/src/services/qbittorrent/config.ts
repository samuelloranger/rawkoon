import { prisma } from "@rawkoon/api/db";
import {
  getJsonCache,
  setJsonCache,
  deleteCache,
} from "@rawkoon/api/services/cache";
import { decrypt } from "@rawkoon/api/services/crypto";
import { toRecord, toStringOrNull } from "./clientNormalizers";
import type { QbittorrentIntegrationConfig } from "./clientTypes";

export const normalizeQbittorrentConfig = (
  config: unknown,
): QbittorrentIntegrationConfig | null => {
  const cfg = toRecord(config);
  if (!cfg) return null;

  const websiteUrl = toStringOrNull(cfg.website_url);
  const username = toStringOrNull(cfg.username);
  let password = toStringOrNull(cfg.password);
  if (password) {
    try {
      password = decrypt(password);
    } catch (error) {
      // Fail closed: SECRET_KEY likely changed. Drop the value so qBittorrent
      // reads as unconfigured rather than authenticating with ciphertext.
      console.error(
        `[qbittorrent] failed to decrypt stored password — treating qBittorrent as unconfigured until re-saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      password = null;
    }
  }
  if (!websiteUrl || !username || !password) return null;

  let webhookSecret = toStringOrNull(cfg.webhook_secret);
  if (webhookSecret) {
    try {
      webhookSecret = decrypt(webhookSecret);
    } catch (error) {
      console.error(
        `[qbittorrent] failed to decrypt stored webhook secret — dropping it until re-saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      webhookSecret = null;
    }
  }

  return {
    website_url: websiteUrl.replace(/\/+$/, ""),
    username,
    password,
    ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
  };
};

// --- Integration config cache (Redis, 24h TTL) ---

const INTEGRATION_CONFIG_CACHE_KEY = "qbittorrent:integration_config";
const INTEGRATION_CONFIG_CACHE_TTL_SECONDS = 86400; // 24h -- invalidated on settings save

export const getQbittorrentIntegrationConfig = async (): Promise<{
  enabled: boolean;
  config: QbittorrentIntegrationConfig | null;
}> => {
  const cached = await getJsonCache<{
    enabled: boolean;
    config: unknown;
  }>(INTEGRATION_CONFIG_CACHE_KEY);
  if (cached) {
    return {
      enabled: cached.enabled,
      config: cached.enabled ? normalizeQbittorrentConfig(cached.config) : null,
    };
  }

  const integration = await prisma.integration.findFirst({
    where: { type: "qbittorrent" },
    select: { enabled: true, config: true },
  });

  const enabled = integration?.enabled ?? false;
  const rawConfig = integration?.config ?? null;

  await setJsonCache(
    INTEGRATION_CONFIG_CACHE_KEY,
    { enabled, config: rawConfig },
    INTEGRATION_CONFIG_CACHE_TTL_SECONDS,
  );

  return {
    enabled,
    config: enabled ? normalizeQbittorrentConfig(rawConfig) : null,
  };
};

export const invalidateQbittorrentIntegrationConfigCache = async () => {
  await deleteCache(INTEGRATION_CONFIG_CACHE_KEY);
};
