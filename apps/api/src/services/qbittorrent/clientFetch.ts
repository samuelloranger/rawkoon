import { logQbittorrentRequest } from "./requestLogs";
import type { QbittorrentIntegrationConfig } from "./clientTypes";
import { toRecord } from "./clientNormalizers";
import {
  getByteLength,
  getLastMaindataSnapshot,
  getMaindataFetchPromise,
  getMaindataState,
  MAINDATA_REUSE_WINDOW_MS,
  qbRequest,
  setLastMaindataSnapshot,
  setMaindataFetchPromise,
  setMaindataState,
} from "./clientSession";

interface MaindataRaw {
  rid?: number;
  full_update?: boolean;
  server_state?: Record<string, unknown>;
  torrents?: Record<string, Record<string, unknown>>;
  torrents_removed?: string[];
}

const getQbittorrentPayloadMetrics = (url: URL, payload: unknown) => {
  const record = toRecord(payload);
  const metrics: {
    rid?: number;
    fullUpdate?: boolean;
    itemCount?: number;
    removedCount?: number;
    meta: Record<string, unknown>;
  } = {
    meta: {
      query: Object.fromEntries(url.searchParams.entries()),
    },
  };

  if (Array.isArray(payload)) {
    metrics.itemCount = payload.length;
    metrics.meta.payloadKind = "array";
    return metrics;
  }

  if (!record) {
    metrics.meta.payloadKind = typeof payload;
    return metrics;
  }

  metrics.meta.payloadKind = "object";

  if (typeof record.rid === "number") metrics.rid = record.rid;
  if (typeof record.full_update === "boolean")
    metrics.fullUpdate = record.full_update;

  if (url.pathname === "/api/v2/sync/maindata") {
    const torrents = toRecord(record.torrents);
    const removed = Array.isArray(record.torrents_removed)
      ? record.torrents_removed
      : [];
    metrics.itemCount = torrents ? Object.keys(torrents).length : 0;
    metrics.removedCount = removed.length;
    metrics.meta.serverStateKeys = toRecord(record.server_state)
      ? Object.keys(toRecord(record.server_state)!).length
      : 0;
    return metrics;
  }

  if (url.pathname === "/api/v2/sync/torrentPeers") {
    const peers = toRecord(record.peers);
    metrics.itemCount = peers ? Object.keys(peers).length : 0;
    return metrics;
  }

  if (url.pathname === "/api/v2/torrents/info") {
    metrics.itemCount = Array.isArray(payload) ? payload.length : undefined;
    return metrics;
  }

  if (url.pathname === "/api/v2/torrents/categories") {
    metrics.itemCount = Object.keys(record).length;
    return metrics;
  }

  return metrics;
};

export const qbFetchJson = async <T>(
  config: QbittorrentIntegrationConfig,
  path: string,
): Promise<T> => {
  const result = await qbRequest(config, path, {
    headers: {
      Accept: "application/json",
    },
  });

  try {
    const parsed = JSON.parse(result.bodyText) as T;
    const metrics = getQbittorrentPayloadMetrics(result.url, parsed);
    logQbittorrentRequest({
      method: "GET",
      endpoint: result.url.pathname,
      requestPath: `${result.url.pathname}${result.url.search}`,
      statusCode: result.statusCode,
      ok: true,
      durationMs: result.durationMs,
      responseBytes: getByteLength(result.bodyText),
      authRetried: result.authRetried,
      rid: metrics.rid,
      fullUpdate: metrics.fullUpdate,
      itemCount: metrics.itemCount,
      removedCount: metrics.removedCount,
      meta: metrics.meta,
    });
    return parsed;
  } catch (error) {
    logQbittorrentRequest({
      method: "GET",
      endpoint: result.url.pathname,
      requestPath: `${result.url.pathname}${result.url.search}`,
      statusCode: result.statusCode,
      ok: false,
      durationMs: result.durationMs,
      responseBytes: getByteLength(result.bodyText),
      authRetried: result.authRetried,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Invalid qBittorrent JSON payload",
    });
    throw error;
  }
};

export const qbFetchText = async (
  config: QbittorrentIntegrationConfig,
  path: string,
  init?: RequestInit,
): Promise<string> => {
  const result = await qbRequest(config, path, {
    ...init,
    headers: {
      Accept: "text/plain, */*",
      Referer: config.website_url,
      ...(init?.headers ?? {}),
    },
  });

  logQbittorrentRequest({
    method: (init?.method ?? "GET").toUpperCase(),
    endpoint: result.url.pathname,
    requestPath: `${result.url.pathname}${result.url.search}`,
    statusCode: result.statusCode,
    ok: true,
    durationMs: result.durationMs,
    responseBytes: getByteLength(result.bodyText),
    authRetried: result.authRetried,
    meta: {
      payloadKind: "text",
    },
  });

  return result.bodyText;
};

export const fetchMaindata = async (
  config: QbittorrentIntegrationConfig,
): Promise<{
  serverState: Record<string, unknown>;
  torrents: Map<string, Record<string, unknown>>;
}> => {
  const now = Date.now();
  const lastMaindataSnapshot = getLastMaindataSnapshot();
  if (
    lastMaindataSnapshot &&
    now - lastMaindataSnapshot.fetchedAt <= MAINDATA_REUSE_WINDOW_MS
  ) {
    return {
      serverState: lastMaindataSnapshot.serverState,
      torrents: lastMaindataSnapshot.torrents,
    };
  }

  const existingPromise = getMaindataFetchPromise();
  if (existingPromise) {
    return existingPromise;
  }

  const fetchPromise = (async () => {
    const maindataState = getMaindataState();
    const rid = maindataState?.rid ?? 0;
    const raw = await qbFetchJson<MaindataRaw>(
      config,
      `/api/v2/sync/maindata?rid=${rid}`,
    );

    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid maindata response");
    }

    let currentState = getMaindataState();

    if (raw.full_update || !currentState) {
      const torrents = new Map<string, Record<string, unknown>>();
      if (raw.torrents) {
        for (const [hash, torrent] of Object.entries(raw.torrents)) {
          torrents.set(hash, { ...torrent, hash });
        }
      }
      currentState = {
        rid: typeof raw.rid === "number" ? raw.rid : 0,
        serverState: raw.server_state ?? {},
        torrents,
      };
      setMaindataState(currentState);
    } else {
      if (typeof raw.rid === "number") {
        currentState.rid = raw.rid;
      }

      if (raw.server_state) {
        Object.assign(currentState.serverState, raw.server_state);
      }

      if (raw.torrents) {
        for (const [hash, delta] of Object.entries(raw.torrents)) {
          const existing = currentState.torrents.get(hash);
          if (existing) {
            Object.assign(existing, delta);
          } else {
            currentState.torrents.set(hash, { ...delta, hash });
          }
        }
      }

      if (raw.torrents_removed) {
        for (const hash of raw.torrents_removed) {
          currentState.torrents.delete(hash);
        }
      }
    }

    const snapshot = {
      serverState: currentState!.serverState,
      torrents: currentState!.torrents,
    };

    setLastMaindataSnapshot({
      fetchedAt: Date.now(),
      ...snapshot,
    });

    return snapshot;
  })().finally(() => {
    setMaindataFetchPromise(null);
  });

  setMaindataFetchPromise(fetchPromise);

  try {
    return await fetchPromise;
  } catch (error) {
    setLastMaindataSnapshot(null);
    throw error;
  }
};
