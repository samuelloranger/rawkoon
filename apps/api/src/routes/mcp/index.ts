import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "@rawkoon/api/honoEnv";
import { authenticateMcpCaller, type McpCaller } from "./auth";
import {
  errorResponse,
  INVALID_PARAMS,
  INVALID_REQUEST,
  isNotification,
  isValidRequest,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  readId,
  MCP_AUTH_ERROR,
} from "./jsonrpc";
import {
  callTool,
  initializeResult,
  toolByName,
  toolsForScopes,
} from "./tools";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH_MESSAGES = 20;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const tooLarge = () =>
  json(
    errorResponse(
      null,
      INVALID_REQUEST,
      `Request body exceeds ${MAX_BODY_BYTES / 1024} KiB`,
    ),
    413,
  );

/** Notifications answer 202 with an empty body, per the Streamable HTTP spec. */
const accepted = () => new Response(null, { status: 202 });

async function handleOneMessage(
  message: { id?: unknown; method: string; params?: unknown },
  caller: McpCaller,
): Promise<{ jsonrpc: "2.0"; id: unknown; result?: unknown; error?: unknown }> {
  const id = readId(message);
  const params =
    message.params !== null &&
    typeof message.params === "object" &&
    !Array.isArray(message.params)
      ? (message.params as Record<string, unknown>)
      : {};

  switch (message.method) {
    case "initialize": {
      const clientVersion =
        typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : undefined;
      return { jsonrpc: "2.0", id, result: initializeResult(clientVersion) };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: toolsForScopes(caller.scopes).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : null;
      if (!name) {
        return {
          jsonrpc: "2.0",
          id,
          error: errorResponse(id, INVALID_PARAMS, "Missing tool name").error,
        };
      }
      const tool = toolByName(name);
      if (!tool) {
        return {
          jsonrpc: "2.0",
          id,
          error: errorResponse(id, INVALID_PARAMS, `Unknown tool: ${name}`)
            .error,
        };
      }
      const result = await callTool(tool, params.arguments, caller);
      return { jsonrpc: "2.0", id, result };
    }
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: errorResponse(
          id,
          METHOD_NOT_FOUND,
          `Unknown method: ${message.method}`,
        ).error,
      };
  }
}

/**
 * Hand-rolled MCP "Streamable HTTP" endpoint (JSON-RPC 2.0, no SDK): one POST
 * per message or batch, no SSE stream. Mounted at /api/mcp by the edge.
 */
export const mcpRoutes = new Hono<Env>()
  .get(
    "/",
    () =>
      new Response(null, {
        status: 405,
        headers: { allow: "POST", "cache-control": "no-store" },
      }),
  )
  .post(
    "/",
    // Streams the body and aborts past the cap, so an oversized body without
    // a Content-Length header is still refused before buffering.
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => tooLarge(),
    }),
    async (c) => {
      // bodyLimit rejected oversize bodies before this handler ran — early on
      // Content-Length, streaming otherwise — so nothing oversized reaches auth
      // or the body read. Authenticate next: the key lives in the headers, and
      // an unauthenticated request should never cost a body read.
      const caller = await authenticateMcpCaller(c.req.raw);
      if (!caller) {
        return json(
          errorResponse(
            null,
            MCP_AUTH_ERROR,
            "Unauthorized: a valid API key with MCP permissions is required (x-api-key header, or Authorization: Bearer).",
          ),
          401,
        );
      }

      const raw = await c.req.raw.arrayBuffer();
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return json(
          errorResponse(
            null,
            PARSE_ERROR,
            "Parse error: body is not valid JSON",
          ),
          400,
        );
      }

      const batch = Array.isArray(parsed) ? parsed : [parsed];
      if (batch.length === 0) {
        return json(errorResponse(null, INVALID_REQUEST, "Empty batch"), 400);
      }
      if (batch.length > MAX_BATCH_MESSAGES) {
        return json(
          errorResponse(
            null,
            INVALID_REQUEST,
            `Batch too long: at most ${MAX_BATCH_MESSAGES} messages`,
          ),
          400,
        );
      }

      let anyResponse = false;
      const responses: unknown[] = [];
      for (const entry of batch) {
        if (
          entry === null ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          !isValidRequest(entry)
        ) {
          responses.push(
            errorResponse(
              null,
              INVALID_REQUEST,
              "Invalid Request: not a JSON-RPC 2.0 message",
            ),
          );
          anyResponse = true;
          continue;
        }
        const message = entry as {
          id?: unknown;
          method: string;
          params?: unknown;
        };
        if (isNotification(message)) continue;
        responses.push(await handleOneMessage(message, caller));
        anyResponse = true;
      }

      if (!anyResponse) return accepted();
      // A single-message POST answers with one object, not a one-element array.
      if (!Array.isArray(parsed)) return json(responses[0]);
      return json(responses);
    },
  )
  .notFound(() => new Response(null, { status: 404 }));
