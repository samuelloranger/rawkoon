import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeJellyfinConfig } from "@rawkoon/api/utils/integrations/normalizers";
import type { JellyfinIntegrationConfig } from "@rawkoon/api/utils/integrations/types";

const JELLYFIN_TIMEOUT_MS = 10_000;

/** Jellyfin 12 accepts only this header; the legacy X-Emby-Token header gets a 401. */
export function jellyfinAuthHeader(token: string): Record<string, string> {
  return { Authorization: `MediaBrowser Token="${token}"` };
}

/** Marks sessions minted from a Jellyfin token, so relinking can revoke them. */
export const JELLYFIN_SESSION_AGENT_PREFIX = "Jellyfin: ";

export interface JellyfinUser {
  id: string;
  name: string;
  disabled: boolean;
}

/**
 * Sessions minted from Jellyfin credentials or a Jellyfin token. Used
 * everywhere those sessions are revoked, so the two marks stay in step.
 */
export const JELLYFIN_PROVIDER_ID = "jellyfin";

export function jellyfinSessionWhere(userIds?: string | string[]) {
  const marked = [
    { providerId: JELLYFIN_PROVIDER_ID },
    { userAgent: { startsWith: JELLYFIN_SESSION_AGENT_PREFIX } },
  ];
  if (userIds === undefined) return { OR: marked };
  return {
    userId: Array.isArray(userIds) ? { in: userIds } : userIds,
    OR: marked,
  };
}

export async function getJellyfinConfig(): Promise<JellyfinIntegrationConfig | null> {
  const integration = await getIntegrationConfigRecord("jellyfin");
  if (!integration?.enabled) return null;
  return normalizeJellyfinConfig(integration.config);
}

function toJellyfinUser(raw: unknown): JellyfinUser | null {
  if (!raw || typeof raw !== "object") return null;
  const { Id, Name, Policy } = raw as {
    Id?: unknown;
    Name?: unknown;
    Policy?: { IsDisabled?: unknown } | null;
  };
  if (typeof Id !== "string" || !Id) return null;
  return {
    id: Id,
    name: typeof Name === "string" ? Name : "",
    disabled: Policy?.IsDisabled === true,
  };
}

/**
 * Resolves the Jellyfin user that owns `token`, asking the configured server
 * (never one the client names). `null` means Jellyfin rejected the token.
 */
export async function resolveJellyfinTokenUser(
  config: JellyfinIntegrationConfig,
  token: string,
): Promise<JellyfinUser | null> {
  const res = await fetch(`${config.website_url}/Users/Me`, {
    headers: jellyfinAuthHeader(token),
    signal: AbortSignal.timeout(JELLYFIN_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Jellyfin /Users/Me returned ${res.status}`);
  return toJellyfinUser(await res.json());
}

function clientAuthHeader(token?: string): Record<string, string> {
  const fields = [
    'Client="Rawkoon"',
    'Device="Rawkoon"',
    'DeviceId="rawkoon-server"',
    `Version="${process.env.APP_VERSION || "0.0.0"}"`,
  ];
  if (token) fields.push(`Token="${token}"`);
  return { Authorization: `MediaBrowser ${fields.join(", ")}` };
}

/**
 * Checks a username and password against the configured Jellyfin server.
 * `null` means the credentials were rejected; any other failure throws. The
 * Jellyfin session this opens is closed again so no device entry is left.
 */
export async function authenticateJellyfinUser(
  config: JellyfinIntegrationConfig,
  username: string,
  password: string,
): Promise<JellyfinUser | null> {
  const res = await fetch(`${config.website_url}/Users/AuthenticateByName`, {
    method: "POST",
    headers: { ...clientAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ Username: username, Pw: password }),
    signal: AbortSignal.timeout(JELLYFIN_TIMEOUT_MS),
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(
      `Jellyfin /Users/AuthenticateByName returned ${res.status}`,
    );
  }
  const body = (await res.json()) as { User?: unknown; AccessToken?: unknown };
  const user = toJellyfinUser(body.User);
  if (!user) throw new Error("Jellyfin returned no user");
  if (typeof body.AccessToken === "string" && body.AccessToken) {
    try {
      await fetch(`${config.website_url}/Sessions/Logout`, {
        method: "POST",
        headers: clientAuthHeader(body.AccessToken),
        signal: AbortSignal.timeout(JELLYFIN_TIMEOUT_MS),
      });
    } catch (error) {
      console.warn("[jellyfin] could not end the sign-in session:", error);
    }
  }
  return user;
}

export async function listJellyfinUsers(
  config: JellyfinIntegrationConfig,
): Promise<JellyfinUser[]> {
  const res = await fetch(`${config.website_url}/Users`, {
    headers: jellyfinAuthHeader(config.api_key),
    signal: AbortSignal.timeout(JELLYFIN_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Jellyfin /Users returned ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) return [];
  return body.map(toJellyfinUser).filter((u): u is JellyfinUser => u !== null);
}

/**
 * Approves a pending Quick Connect request for `jellyfinUserId` using the
 * admin API key. Jellyfin answers 404 for a code it doesn't know or that expired.
 */
export async function authorizeJellyfinQuickConnect(
  config: JellyfinIntegrationConfig,
  code: string,
  jellyfinUserId: string,
): Promise<"ok" | "unknown_code"> {
  const url = new URL("/QuickConnect/Authorize", config.website_url);
  url.searchParams.set("code", code);
  url.searchParams.set("userId", jellyfinUserId);
  const res = await fetch(url, {
    method: "POST",
    headers: jellyfinAuthHeader(config.api_key),
    signal: AbortSignal.timeout(JELLYFIN_TIMEOUT_MS),
  });
  if (res.status === 404) return "unknown_code";
  if (!res.ok) {
    throw new Error(`Jellyfin /QuickConnect/Authorize returned ${res.status}`);
  }
  return "ok";
}
