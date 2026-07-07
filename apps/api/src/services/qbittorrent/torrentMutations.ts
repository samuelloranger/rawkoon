import type { QbittorrentIntegrationConfig } from "./clientTypes";
import { qbFetchText } from "./clientFetch";

export const setQbittorrentTorrentCategory = async (
  config: QbittorrentIntegrationConfig,
  enabled: boolean,
  payload: { hash: string; category: string | null },
): Promise<{
  enabled: boolean;
  connected: boolean;
  success: boolean;
  error?: string;
}> => {
  if (!enabled) return { enabled: false, connected: false, success: false };
  const safeHash = payload.hash.trim();
  if (!safeHash) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error: "Missing torrent hash",
    };
  }
  const category = payload.category?.trim() ?? "";

  const body = new URLSearchParams();
  body.set("hashes", safeHash);
  body.set("category", category);

  try {
    await qbFetchText(config, "/api/v2/torrents/setCategory", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return { enabled: true, connected: true, success: true };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update category",
    };
  }
};

export const setQbittorrentTorrentTags = async (
  config: QbittorrentIntegrationConfig,
  enabled: boolean,
  payload: { hash: string; tags: string[]; previous_tags?: string[] | null },
): Promise<{
  enabled: boolean;
  connected: boolean;
  success: boolean;
  error?: string;
}> => {
  if (!enabled) return { enabled: false, connected: false, success: false };
  const safeHash = payload.hash.trim();
  if (!safeHash) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error: "Missing torrent hash",
    };
  }

  const normalizeList = (list: string[] | null | undefined): string[] =>
    Array.isArray(list)
      ? list
          .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
          .filter(Boolean)
          .slice(0, 50)
      : [];

  const nextTags = normalizeList(payload.tags);
  const prevTags = normalizeList(payload.previous_tags ?? null);

  try {
    if (prevTags.length > 0) {
      const removeBody = new URLSearchParams();
      removeBody.set("hashes", safeHash);
      removeBody.set("tags", prevTags.join(","));
      await qbFetchText(config, "/api/v2/torrents/removeTags", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: removeBody.toString(),
      });
    }

    if (nextTags.length > 0) {
      const addBody = new URLSearchParams();
      addBody.set("hashes", safeHash);
      addBody.set("tags", nextTags.join(","));
      await qbFetchText(config, "/api/v2/torrents/addTags", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: addBody.toString(),
      });
    }

    return { enabled: true, connected: true, success: true };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error: error instanceof Error ? error.message : "Failed to update tags",
    };
  }
};

export const deleteQbittorrentTorrent = async (
  config: QbittorrentIntegrationConfig,
  enabled: boolean,
  payload: { hash: string; delete_files: boolean },
): Promise<{
  enabled: boolean;
  connected: boolean;
  success: boolean;
  error?: string;
}> => {
  if (!enabled) return { enabled: false, connected: false, success: false };
  const safeHash = payload.hash.trim();
  if (!safeHash) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error: "Missing torrent hash",
    };
  }

  const body = new URLSearchParams();
  body.set("hashes", safeHash);
  body.set("deleteFiles", payload.delete_files ? "true" : "false");

  try {
    await qbFetchText(config, "/api/v2/torrents/delete", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return { enabled: true, connected: true, success: true };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to delete torrent",
    };
  }
};

// ponytail: qB 5.0 renamed pause→stop / resume→start. Try the 5.x path,
// fall back to the 4.x path on failure. Drop the fallback once 4.x is unsupported.
const toggleTorrentState = async (
  config: QbittorrentIntegrationConfig,
  enabled: boolean,
  payload: { hash: string },
  paths: [primary: string, fallback: string],
  action: string,
): Promise<{
  enabled: boolean;
  connected: boolean;
  success: boolean;
  error?: string;
}> => {
  if (!enabled) return { enabled: false, connected: false, success: false };
  const safeHash = payload.hash.trim();
  if (!safeHash) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error: "Missing torrent hash",
    };
  }

  const body = new URLSearchParams();
  body.set("hashes", safeHash);
  const opts = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  } as const;

  try {
    try {
      await qbFetchText(config, paths[0], opts);
    } catch {
      await qbFetchText(config, paths[1], opts);
    }
    return { enabled: true, connected: true, success: true };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      success: false,
      error:
        error instanceof Error ? error.message : `Failed to ${action} torrent`,
    };
  }
};

export const pauseQbittorrentTorrent = (
  config: QbittorrentIntegrationConfig,
  enabled: boolean,
  payload: { hash: string },
) =>
  toggleTorrentState(
    config,
    enabled,
    payload,
    ["/api/v2/torrents/stop", "/api/v2/torrents/pause"],
    "pause",
  );

export const resumeQbittorrentTorrent = (
  config: QbittorrentIntegrationConfig,
  enabled: boolean,
  payload: { hash: string },
) =>
  toggleTorrentState(
    config,
    enabled,
    payload,
    ["/api/v2/torrents/start", "/api/v2/torrents/resume"],
    "resume",
  );
