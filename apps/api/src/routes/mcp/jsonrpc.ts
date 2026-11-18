/**
 * Minimal JSON-RPC 2.0 support for the MCP "Streamable HTTP" transport.
 * Hand-rolled on purpose (no SDK): the endpoint only needs a request/response
 * envelope, notifications, and three error codes.
 */

export const PARSE_ERROR = -32700 as const;
export const INVALID_REQUEST = -32600 as const;
export const METHOD_NOT_FOUND = -32601 as const;
export const INVALID_PARAMS = -32602 as const;
// Server error range; documented in docs/mcp.md as the auth failure code.
export const MCP_AUTH_ERROR = -32001 as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export function errorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
): {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorBody;
} {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** A message without an `id` is a notification and gets no response at all. */
export function isNotification(message: { id?: unknown }): boolean {
  return message.id === undefined;
}

export function readId(message: { id?: unknown }): JsonRpcId {
  const id = message.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/** Structurally valid per JSON-RPC 2.0 (method a string, jsonrpc "2.0"). */
export function isValidRequest(message: {
  jsonrpc?: unknown;
  method?: unknown;
}): boolean {
  return (
    typeof message.method === "string" &&
    message.method.length > 0 &&
    message.jsonrpc === "2.0"
  );
}
