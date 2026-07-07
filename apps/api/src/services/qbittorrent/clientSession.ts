import { logQbittorrentRequest } from "./requestLogs";
import type { QbittorrentIntegrationConfig } from "./clientTypes";

interface SessionState {
  key: string;
  sidCookie: string | null;
}

interface MaindataState {
  rid: number;
  serverState: Record<string, unknown>;
  torrents: Map<string, Record<string, unknown>>;
}

const qbSession: SessionState = {
  key: "",
  sidCookie: null,
};

let maindataState: MaindataState | null = null;
let maindataFetchPromise: Promise<{
  serverState: Record<string, unknown>;
  torrents: Map<string, Record<string, unknown>>;
}> | null = null;
let lastMaindataSnapshot: {
  fetchedAt: number;
  serverState: Record<string, unknown>;
  torrents: Map<string, Record<string, unknown>>;
} | null = null;

export const MAINDATA_REUSE_WINDOW_MS = 750;

export const resetMaindataState = () => {
  maindataState = null;
  maindataFetchPromise = null;
  lastMaindataSnapshot = null;
};

export const getMaindataState = () => maindataState;
export const setMaindataState = (state: MaindataState | null) => {
  maindataState = state;
};

export const getMaindataFetchPromise = () => maindataFetchPromise;
export const setMaindataFetchPromise = (
  promise: Promise<{
    serverState: Record<string, unknown>;
    torrents: Map<string, Record<string, unknown>>;
  }> | null,
) => {
  maindataFetchPromise = promise;
};

export const getLastMaindataSnapshot = () => lastMaindataSnapshot;
export const setLastMaindataSnapshot = (
  snapshot: typeof lastMaindataSnapshot,
) => {
  lastMaindataSnapshot = snapshot;
};

const textEncoder = new TextEncoder();

export const getByteLength = (value: string) =>
  textEncoder.encode(value).length;

const buildConfigKey = (config: QbittorrentIntegrationConfig): string =>
  `${config.website_url}|${config.username}|${config.password}`;

const parseSidCookie = (response: Response): string | null => {
  const h = response.headers as Headers & { getSetCookie?: () => string[] };

  const tryPair = (cookieHeaderLine: string): string | null => {
    const nameValue = cookieHeaderLine.split(";")[0]?.trim() ?? "";
    return /^(?:QBT_)?SID(?:_\d+)?=/i.test(nameValue) ? nameValue : null;
  };

  if (typeof h.getSetCookie === "function") {
    const list = h.getSetCookie();
    for (const raw of list) {
      const hit = tryPair(raw);
      if (hit) return hit;
    }
  }

  const raw = response.headers.get("set-cookie");
  if (!raw) return null;
  const fromFirstAttr = tryPair(raw);
  if (fromFirstAttr) return fromFirstAttr;

  const commaParts = raw.split(",").map((part) => part.trim());
  for (const part of commaParts) {
    const hit = tryPair(part);
    if (hit) return hit;
  }
  return null;
};

const resetSessionIfConfigChanged = (config: QbittorrentIntegrationConfig) => {
  const key = buildConfigKey(config);
  if (qbSession.key === key) return;
  qbSession.key = key;
  qbSession.sidCookie = null;
  resetMaindataState();
};

const login = async (
  config: QbittorrentIntegrationConfig,
): Promise<boolean> => {
  const loginUrl = new URL("/api/v2/auth/login", config.website_url);
  const body = new URLSearchParams({
    username: config.username,
    password: config.password,
  });

  const startedAt = Date.now();

  try {
    const response = await fetch(loginUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: config.website_url,
      },
      body: body.toString(),
    });

    const text = (await response.text()).trim();

    qbSession.sidCookie = parseSidCookie(response);
    const legacyOkBody = /^ok\.?$/i.test(text);
    const loginSucceeded =
      response.ok && (qbSession.sidCookie != null || legacyOkBody);

    logQbittorrentRequest({
      method: "POST",
      endpoint: loginUrl.pathname,
      requestPath: `${loginUrl.pathname}${loginUrl.search}`,
      statusCode: response.status,
      ok: loginSucceeded && Boolean(qbSession.sidCookie),
      durationMs: Date.now() - startedAt,
      responseBytes: getByteLength(text),
      errorMessage:
        loginSucceeded && qbSession.sidCookie
          ? null
          : "qBittorrent authentication failed",
      meta: {
        hasSidCookie: Boolean(qbSession.sidCookie),
      },
    });

    // Honor the legacy 'Ok.' body: some WebUI/proxy setups authenticate without
    // emitting a Set-Cookie. qbRequest tolerates a null sidCookie as long as
    // login() reports success, so it proceeds cookieless instead of hard-failing.
    return loginSucceeded;
  } catch (error) {
    logQbittorrentRequest({
      method: "POST",
      endpoint: loginUrl.pathname,
      requestPath: `${loginUrl.pathname}${loginUrl.search}`,
      ok: false,
      durationMs: Date.now() - startedAt,
      errorMessage:
        error instanceof Error
          ? error.message
          : "qBittorrent authentication request failed",
    });
    return false;
  }
};

export type QbRequestResult = {
  url: URL;
  bodyText: string;
  statusCode: number;
  authRetried: boolean;
  durationMs: number;
};

export const qbRequest = async (
  config: QbittorrentIntegrationConfig,
  path: string,
  init?: RequestInit,
): Promise<QbRequestResult> => {
  resetSessionIfConfigChanged(config);

  const url = new URL(path, config.website_url);
  const startedAt = Date.now();

  const request = async (): Promise<Response> => {
    const mergedHeaders = new Headers(init?.headers ?? {});
    if (qbSession.sidCookie) mergedHeaders.set("Cookie", qbSession.sidCookie);
    return fetch(url.toString(), { ...init, headers: mergedHeaders });
  };

  let authRetried = false;
  let statusCode: number | null = null;

  try {
    if (!qbSession.sidCookie) {
      const loggedIn = await login(config);
      if (!loggedIn) {
        throw new Error("qBittorrent authentication failed");
      }
    }

    let response = await request();
    statusCode = response.status;

    if (response.status === 403 || response.status === 401) {
      authRetried = true;
      const loggedIn = await login(config);
      if (!loggedIn) {
        throw new Error("qBittorrent authentication failed");
      }
      response = await request();
      statusCode = response.status;
    }

    const bodyText = await response.text();
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      logQbittorrentRequest({
        method: (init?.method ?? "GET").toUpperCase(),
        endpoint: url.pathname,
        requestPath: `${url.pathname}${url.search}`,
        statusCode: response.status,
        ok: false,
        durationMs,
        responseBytes: getByteLength(bodyText),
        authRetried,
        errorMessage: `qBittorrent request failed with status ${response.status}`,
      });
      throw new Error(
        `qBittorrent request failed with status ${response.status}`,
      );
    }

    return {
      url,
      bodyText,
      statusCode: response.status,
      authRetried,
      durationMs,
    };
  } catch (error) {
    if (statusCode == null || error instanceof TypeError) {
      logQbittorrentRequest({
        method: (init?.method ?? "GET").toUpperCase(),
        endpoint: url.pathname,
        requestPath: `${url.pathname}${url.search}`,
        statusCode,
        ok: false,
        durationMs: Date.now() - startedAt,
        authRetried,
        errorMessage:
          error instanceof Error ? error.message : "qBittorrent request failed",
      });
    }
    throw error;
  }
};
