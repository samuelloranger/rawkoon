import {
  getDownloadClientIntegrationConfig,
  type DownloadClientIntegrationConfig,
} from "./config";
import { createDelugeAdapter } from "./delugeAdapter";
import { createQbittorrentAdapter } from "./qbittorrentAdapter";
import { createTransmissionAdapter } from "./transmissionAdapter";
import type {
  DownloadClientAdapter,
  DownloadClientType,
} from "./types";

export function buildAdapter(
  clientType: DownloadClientType,
  config: DownloadClientIntegrationConfig,
): DownloadClientAdapter {
  switch (clientType) {
    case "qbittorrent":
      return createQbittorrentAdapter({
        website_url: config.website_url,
        username: config.username,
        password: config.password,
      });
    case "transmission":
      return createTransmissionAdapter(config);
    case "deluge":
      return createDelugeAdapter(config);
  }
}

export async function resolveActiveAdapter(): Promise<{
  adapter: DownloadClientAdapter;
  label: string;
  savePath?: string;
} | null> {
  const { enabled, clientType, config } =
    await getDownloadClientIntegrationConfig();
  if (!enabled || !clientType || !config) return null;
  return {
    adapter: buildAdapter(clientType, config),
    label: config.label,
    savePath: config.save_path,
  };
}
