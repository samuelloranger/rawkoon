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
}

export async function getJellyfinConfig(): Promise<JellyfinIntegrationConfig | null> {
  const integration = await getIntegrationConfigRecord("jellyfin");
  if (!integration?.enabled) return null;
  return normalizeJellyfinConfig(integration.config);
}

function toJellyfinUser(raw: unknown): JellyfinUser | null {
  if (!raw || typeof raw !== "object") return null;
  const { Id, Name } = raw as { Id?: unknown; Name?: unknown };
  if (typeof Id !== "string" || !Id) return null;
  return { id: Id, name: typeof Name === "string" ? Name : "" };
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
