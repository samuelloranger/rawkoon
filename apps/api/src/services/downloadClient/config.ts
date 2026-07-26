import { prisma } from "@rawkoon/api/db";
import {
  deleteCache,
  getJsonCache,
  setJsonCache,
} from "@rawkoon/api/services/cache";
import { decrypt } from "@rawkoon/api/services/crypto";
import {
  toRecord,
  toStringOrNull,
} from "@rawkoon/api/services/qbittorrent/clientNormalizers";
import type { DownloadClientType } from "./types";

export interface DownloadClientIntegrationConfig {
  website_url: string;
  username: string;
  password: string;
  label: string;
  save_path?: string;
}

export const normalizeDownloadClientConfig = (
  config: unknown,
  clientType: DownloadClientType,
): DownloadClientIntegrationConfig | null => {
  const cfg = toRecord(config);
  if (!cfg) return null;

  const websiteUrl = toStringOrNull(cfg.website_url);
  const username = toStringOrNull(cfg.username) ?? "";
  let password = toStringOrNull(cfg.password);
  if (password) {
    try {
      password = decrypt(password);
    } catch (error) {
      console.error(
        `[download-client] failed to decrypt password — treating as unconfigured until re-saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      password = null;
    }
  }

  if (!websiteUrl || !password) return null;
  if (clientType !== "deluge" && !username) return null;

  return {
    website_url: websiteUrl.replace(/\/+$/, ""),
    username,
    password,
    label: toStringOrNull(cfg.label) ?? "rawkoon",
    save_path: toStringOrNull(cfg.save_path) ?? undefined,
  };
};

const CACHE_KEY = "download-client:integration_config";
const CACHE_TTL_SECONDS = 86_400;
const VALID_TYPES: DownloadClientType[] = [
  "qbittorrent",
  "transmission",
  "deluge",
];

const parseClientType = (raw: unknown): DownloadClientType | null => {
  const cfg = toRecord(raw);
  const type = cfg ? toStringOrNull(cfg.client_type) : null;
  return VALID_TYPES.includes(type as DownloadClientType)
    ? (type as DownloadClientType)
    : null;
};

export const getDownloadClientIntegrationConfig = async (): Promise<{
  enabled: boolean;
  clientType: DownloadClientType | null;
  config: DownloadClientIntegrationConfig | null;
}> => {
  const cached = await getJsonCache<{ enabled: boolean; config: unknown }>(
    CACHE_KEY,
  );
  const build = (enabled: boolean, rawConfig: unknown) => {
    const clientType = enabled ? parseClientType(rawConfig) : null;
    return {
      enabled,
      clientType,
      config:
        enabled && clientType
          ? normalizeDownloadClientConfig(rawConfig, clientType)
          : null,
    };
  };

  if (cached) return build(cached.enabled, cached.config);

  const integration = await prisma.integration.findFirst({
    where: { type: "download-client" },
    select: { enabled: true, config: true },
  });
  const enabled = integration?.enabled ?? false;
  const rawConfig = integration?.config ?? null;

  await setJsonCache(
    CACHE_KEY,
    { enabled, config: rawConfig },
    CACHE_TTL_SECONDS,
  );
  return build(enabled, rawConfig);
};

export const invalidateDownloadClientIntegrationConfigCache = async () => {
  await deleteCache(CACHE_KEY);
};
