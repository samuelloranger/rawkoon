import { MCP_SCOPES, type McpScope } from "@rawkoon/shared/types";

/**
 * The api-key plugin parses the permissions column before returning it, but
 * every consumer still parses defensively: the column is a text field that
 * pre-dates any MCP write and may hold anything (including a double-encoded
 * string) on an upgraded instance.
 */
export function parseMcpScopes(permissions: unknown): McpScope[] {
  // Accept a raw JSON string too, so the same parser reads the Prisma column.
  if (typeof permissions === "string") {
    try {
      permissions = JSON.parse(permissions);
    } catch {
      return [];
    }
  }
  if (typeof permissions !== "object" || permissions === null) return [];
  const mcp = (permissions as Record<string, unknown>).mcp;
  if (!Array.isArray(mcp)) return [];
  const allowed: readonly string[] = MCP_SCOPES;
  return mcp
    .filter((s): s is McpScope => typeof s === "string" && allowed.includes(s))
    .filter((s, i, all) => all.indexOf(s) === i);
}
