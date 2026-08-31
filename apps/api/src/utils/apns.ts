import { loadConfig } from "@rawkoon/api/config";

// Push delivery for the native iOS app.
//
// APNs only accepts a push signed by the credential of the team that publishes
// the app, so a self-hosted Rawkoon server can never talk to Apple directly.
// Instead it posts `{ token, title, body }` to the Rawkoon push relay, which
// holds the APNs signing key. The relay is part of the app's distribution (the
// only relay that can serve the App Store build is the one holding the matching
// key), so its URL is a config value with a sensible default rather than
// something each user must set.
//
// PUSH_RELAY_URL overrides the default for anyone running their own relay
// against their own Apple team.

const DEFAULT_RELAY_URL = "https://rawkoon-relay.samlo.cloud";

function relayUrl(): string | null {
  const configured = loadConfig().PUSH_RELAY_URL;
  const url = (configured || DEFAULT_RELAY_URL).replace(/\/+$/, "");
  return url || null;
}

export function isPushConfigured(): boolean {
  return relayUrl() !== null;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

/**
 * Send one push to a device token via the relay. Mirrors the web-push return
 * shape so the worker treats both channels the same: `expired` (the relay
 * reports 410 when the app was uninstalled) tells the caller to drop the token.
 */
export async function sendPushViaRelay(
  deviceToken: string,
  payload: PushPayload,
): Promise<{ success: boolean; expired?: boolean; error?: string }> {
  const base = relayUrl();
  if (!base) return { success: false, error: "Push relay not configured" };

  // The relay wants a bare hex token and a short collapse id (optional).
  const body = JSON.stringify({
    token: deviceToken,
    title: payload.title.slice(0, 100),
    body: payload.body.slice(0, 300),
    ...(payload.tag ? { collapseId: payload.tag.slice(0, 64) } : {}),
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${base}/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (res.status === 200) return { success: true };
    if (res.status === 410)
      return { success: false, expired: true, error: "unregistered" };
    const detail = await res.text().catch(() => "");
    return { success: false, error: `relay ${res.status} ${detail}`.trim() };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
