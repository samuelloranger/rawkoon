import {
  getDownloadClientIntegrationConfig,
  invalidateDownloadClientIntegrationConfigCache,
} from "@rawkoon/api/services/downloadClient/config";
import type { QbittorrentIntegrationConfig } from "./clientTypes";

export const getQbittorrentIntegrationConfig = async (): Promise<{
  enabled: boolean;
  config: QbittorrentIntegrationConfig | null;
}> => {
  const { enabled, clientType, config } =
    await getDownloadClientIntegrationConfig();
  return {
    enabled: enabled && clientType === "qbittorrent",
    config:
      enabled && clientType === "qbittorrent" && config
        ? {
            website_url: config.website_url,
            username: config.username,
            password: config.password,
          }
        : null,
  };
};

export const invalidateQbittorrentIntegrationConfigCache =
  invalidateDownloadClientIntegrationConfigCache;
