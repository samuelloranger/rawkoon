import type { QbittorrentIntegrationConfig } from "./clientTypes";
import { qbFetchText } from "./clientFetch";
import { parseQbittorrentAddResponse } from "./parseAddResponse";

export const addQbittorrentMagnet = async (
  config: QbittorrentIntegrationConfig,
  enabled: boolean,
  payload: {
    magnet: string;
    save_path?: string | null;
    category?: string | null;
    tags?: string[] | null;
  },
): Promise<{
  enabled: boolean;
  connected: boolean;
  success: boolean;
  error?: string;
}> => {
  if (!enabled) return { enabled: false, connected: false, success: false };
  const magnet = payload.magnet.trim();
  if (!magnet.startsWith("magnet:")) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error: "Invalid magnet URL",
    };
  }

  const body = new URLSearchParams();
  body.set("urls", magnet);
  if (payload.save_path) body.set("savepath", payload.save_path);
  if (payload.category) body.set("category", payload.category);
  if (payload.tags && payload.tags.length > 0)
    body.set(
      "tags",
      payload.tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .join(","),
    );

  try {
    const responseText = await qbFetchText(config, "/api/v2/torrents/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const parsed = parseQbittorrentAddResponse(responseText);
    if (!parsed.ok) {
      return {
        enabled: true,
        connected: true,
        success: false,
        error: `qBittorrent rejected magnet: ${parsed.error}`,
      };
    }
    return { enabled: true, connected: true, success: true };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error: error instanceof Error ? error.message : "Failed to add torrent",
    };
  }
};

export const addQbittorrentTorrentFile = async (
  config: QbittorrentIntegrationConfig,
  enabled: boolean,
  payload: {
    torrent: File;
    save_path?: string | null;
    category?: string | null;
    tags?: string[] | null;
  },
): Promise<{
  enabled: boolean;
  connected: boolean;
  success: boolean;
  error?: string;
}> => {
  const logPrefix = "[qbittorrentService:add-file]";
  if (!enabled) return { enabled: false, connected: false, success: false };
  if (!payload.torrent)
    return {
      enabled: true,
      connected: false,
      success: false,
      error: "Missing torrent file",
    };

  const formData = new FormData();
  formData.set("torrents", payload.torrent);
  if (payload.save_path) formData.set("savepath", payload.save_path);
  if (payload.category) formData.set("category", payload.category);
  if (payload.tags && payload.tags.length > 0)
    formData.set(
      "tags",
      payload.tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .join(","),
    );

  try {
    console.log(
      `${logPrefix} sending torrent name="${payload.torrent.name}" size=${payload.torrent.size} category=${payload.category ?? "none"} tags=${payload.tags?.join(",") || "none"}`,
    );
    const responseText = await qbFetchText(config, "/api/v2/torrents/add", {
      method: "POST",
      body: formData,
    });
    const parsed = parseQbittorrentAddResponse(responseText);
    if (!parsed.ok) {
      console.error(
        `${logPrefix} qBittorrent rejected torrent name="${payload.torrent.name}" len=${responseText.length} response="${parsed.error}"`,
      );
      return {
        enabled: true,
        connected: true,
        success: false,
        error: `qBittorrent rejected torrent: ${parsed.error}`,
      };
    }
    console.log(
      `${logPrefix} qBittorrent accepted torrent name="${payload.torrent.name}"`,
    );
    return { enabled: true, connected: true, success: true };
  } catch (error) {
    console.error(
      `${logPrefix} qBittorrent rejected torrent name="${payload.torrent.name}" error=`,
      error,
    );
    return {
      enabled: true,
      connected: false,
      success: false,
      error: error instanceof Error ? error.message : "Failed to add torrent",
    };
  }
};
