import http2 from "node:http2";
import { createPrivateKey, type KeyObject, sign } from "node:crypto";
import { loadConfig } from "@rawkoon/api/config";

// Apple Push Notification service (APNs) sender — token (JWT) based, over
// HTTP/2. Mirrors utils/webpush.ts: load credentials once, send one alert per
// device token, report `expired` (HTTP 410 / BadDeviceToken / Unregistered) so
// the worker can self-heal by deleting dead tokens.
//
// The whole channel is a no-op unless APNS_KEY_ID / APNS_TEAM_ID /
// APNS_BUNDLE_ID / APNS_AUTH_KEY are configured, so it is safe to ship dark.

interface ApnsCreds {
  keyId: string;
  teamId: string;
  bundleId: string;
  key: KeyObject;
  host: string; // https://api.push.apple.com or sandbox
}

// undefined = not yet loaded; null = not configured; object = ready.
let creds: ApnsCreds | null | undefined;
let jwtCache: { token: string; iat: number } | null = null;
let session: http2.ClientHttp2Session | null = null;

const b64u = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

function loadCreds(): ApnsCreds | null {
  if (creds !== undefined) return creds;
  const env = loadConfig();
  if (
    !env.APNS_KEY_ID ||
    !env.APNS_TEAM_ID ||
    !env.APNS_BUNDLE_ID ||
    !env.APNS_AUTH_KEY
  ) {
    creds = null;
    return null;
  }
  // APNS_AUTH_KEY may be the raw .p8 PEM or its base64 encoding (env-friendly).
  let pem = env.APNS_AUTH_KEY;
  if (!pem.includes("BEGIN")) {
    pem = Buffer.from(pem, "base64").toString("utf8");
  }
  const key = createPrivateKey(pem);
  const host =
    env.APNS_PRODUCTION === "true"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  creds = {
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    bundleId: env.APNS_BUNDLE_ID,
    key,
    host,
  };
  return creds;
}

export function isApnsConfigured(): boolean {
  return loadCreds() !== null;
}

/** APNs provider JWT. Apple allows reuse for up to 1h; refresh every ~50 min. */
function apnsJwt(c: ApnsCreds): string {
  const now = Math.floor(Date.now() / 1000);
  if (jwtCache && now - jwtCache.iat < 3000) return jwtCache.token;
  const header = b64u(JSON.stringify({ alg: "ES256", kid: c.keyId }));
  const payload = b64u(JSON.stringify({ iss: c.teamId, iat: now }));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: c.key,
    dsaEncoding: "ieee-p1363",
  });
  const token = `${header}.${payload}.${b64u(signature)}`;
  jwtCache = { token, iat: now };
  return token;
}

function getSession(host: string): http2.ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session;
  session = http2.connect(host);
  session.on("error", () => {
    session = null;
  });
  session.on("close", () => {
    session = null;
  });
  return session;
}

export interface ApnsPayload {
  title: string;
  body: string;
  badge?: number;
  tag?: string;
  data?: Record<string, unknown>;
}

export async function sendApnsNotification(
  deviceToken: string,
  payload: ApnsPayload,
): Promise<{ success: boolean; expired?: boolean; error?: string }> {
  const c = loadCreds();
  if (!c) return { success: false, error: "APNs not configured" };

  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
    sound: "default",
  };
  if (typeof payload.badge === "number") aps.badge = payload.badge;
  if (payload.tag) aps["thread-id"] = payload.tag;
  const body = JSON.stringify({ aps, ...(payload.data ?? {}) });

  return new Promise((resolve) => {
    let settled = false;
    const done = (r: {
      success: boolean;
      expired?: boolean;
      error?: string;
    }) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    try {
      const s = getSession(c.host);
      const req = s.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${apnsJwt(c)}`,
        "apns-topic": c.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });

      let status = 0;
      let respBody = "";
      req.on("response", (headers) => {
        status = Number(headers[":status"]) || 0;
      });
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        respBody += chunk;
      });
      req.on("end", () => {
        if (status === 200) return done({ success: true });
        if (status === 410 || /BadDeviceToken|Unregistered/.test(respBody)) {
          return done({
            success: false,
            expired: true,
            error: respBody || "expired",
          });
        }
        done({ success: false, error: `APNs ${status} ${respBody}`.trim() });
      });
      req.on("error", (e) => done({ success: false, error: String(e) }));
      req.setTimeout(10_000, () => {
        req.close();
        done({ success: false, error: "APNs request timed out" });
      });
      req.end(body);
    } catch (e) {
      done({ success: false, error: String(e) });
    }
  });
}
