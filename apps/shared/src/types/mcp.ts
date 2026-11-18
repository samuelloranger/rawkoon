/**
 * MCP scopes stored in `ba_api_keys.permissions` under the resource `"mcp"`,
 * using better-auth's api-key plugin shape (`{ resource: actions[] }`).
 * A key with no `mcp` entry is a plain service key and is refused by the
 * MCP endpoint.
 */
export const MCP_SCOPES = ["read", "request", "approve", "admin"] as const;

export type McpScope = (typeof MCP_SCOPES)[number];
