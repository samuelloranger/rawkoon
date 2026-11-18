import { apiKeyApi } from "@rawkoon/api/lib/apiKeyApi";
import type { MappedUser } from "@rawkoon/api/honoEnv";
import type { McpScope } from "@rawkoon/shared/types";
import { parseMcpScopes } from "@rawkoon/api/services/mcp/mcpScopes";
import { findUserById } from "@rawkoon/api/services/mcp/mcpCaller";

export interface McpCaller {
  keyId: string;
  keyName: string | null;
  owner: MappedUser;
  scopes: McpScope[];
}

/** x-api-key first; Codex-style clients only send an Authorization Bearer. */
export function extractApiKey(request: Request): string | null {
  const header = request.headers.get("x-api-key");
  if (header?.trim()) return header.trim();
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer?.trim() || null;
}

/**
 * Verifies the key with better-auth's api-key plugin (which also refuses
 * disabled, expired and quota-exhausted keys), resolves the owner, and reads
 * the "mcp" permissions entry. Returns null for any reason to refuse.
 */
export async function authenticateMcpCaller(
  request: Request,
): Promise<McpCaller | null> {
  const key = extractApiKey(request);
  if (!key) return null;

  const { valid, key: record } = await apiKeyApi.verifyApiKey({
    body: { key },
  });
  if (!valid || !record) return null;

  // A key with no "mcp" entry is a plain service key (e.g. an existing Labby
  // key) and must not reach the MCP tools.
  const scopes = parseMcpScopes(record.permissions);
  if (scopes.length === 0) return null;

  const owner = await findUserById(record.referenceId);
  if (!owner) return null;

  // The admin scope is re-checked at call time: losing admin must not keep the
  // health tool reachable through a stale key.
  const effectiveScopes = owner.is_admin
    ? scopes
    : scopes.filter((s) => s !== "admin");

  return {
    keyId: record.id,
    keyName: record.name,
    owner,
    scopes: effectiveScopes,
  };
}
