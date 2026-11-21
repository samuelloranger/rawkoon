import type { McpScope } from "@rawkoon/shared/types";
import { getAppVersion } from "@rawkoon/api/services/versionService";
import { readTools, healthTool } from "./readTools";
import { actionTools } from "./actionTools";
import { ToolFailure, type McpTool, type McpToolContext } from "./toolShared";
import {
  canonicalJson,
  CONFIRM_TTL_SECONDS,
  newConfirmToken,
  storeConfirmBinding,
  takeConfirmBinding,
} from "./confirm";
import { checkMcpRateLimit, rateLimitMessage } from "./rateLimit";
import { capToolResult } from "./shape";

export const MCP_TOOLS: McpTool[] = [...readTools, ...actionTools, healthTool];

export function toolByName(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}

/** tools/list shows only what this key's scopes allow. */
export function toolsForScopes(scopes: McpScope[]): McpTool[] {
  return MCP_TOOLS.filter((t) => scopes.includes(t.scope));
}

// ---------------------------------------------------------------------------
// tools/call pipeline

export interface ToolCallResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

const CONFIRM_NEXT =
  "Show this to the person. If they agree, call the same tool again " +
  "with the same arguments and this confirm_token.";

const TOKEN_USED_UP = (tool: string) =>
  `This confirm_token is now used up; call ${tool} again without confirm_token to get a new one.`;

function toolResult(value: unknown, isError: boolean): ToolCallResult {
  // The text content carries the same JSON so clients without
  // structuredContent support still see the whole result.
  const text = isError ? String(value) : JSON.stringify(value, null, 2);
  // MCP requires structuredContent to be an object; clients reject the whole
  // result otherwise, so errors omit it and bare arrays get wrapped.
  if (isError) return { content: [{ type: "text", text }], isError };
  const structured =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { result: value };
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
    isError,
  };
}

/**
 * Runs one tools/call end to end: scope check, argument validation, per-key
 * rate limits, the two-step confirm for ACTION tools, result capping and the
 * one-line audit log. Failures are tool errors (plain English), never
 * JSON-RPC protocol errors.
 */
export async function callTool(
  tool: McpTool,
  rawArgs: unknown,
  ctx: McpToolContext,
): Promise<ToolCallResult> {
  const started = Date.now();
  const finish = (value: unknown, isError: boolean) => {
    const outcome = isError ? "error" : "ok";
    console.log(
      `[mcp] key=${ctx.keyName ?? ctx.keyId} tool=${tool.name} ${outcome} ${Date.now() - started}ms`,
    );
    return toolResult(value, isError);
  };

  if (!ctx.scopes.includes(tool.scope)) {
    return finish(
      `This API key's MCP scopes don't allow the "${tool.name}" tool (it needs "${tool.scope}").`,
      true,
    );
  }

  const parsed = tool.args.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return finish(
      `Invalid arguments for "${tool.name}": ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "arguments"} ${i.message}`)
        .join("; ")}`,
      true,
    );
  }
  // confirm_token is pipeline state, not a tool argument: strip it before
  // binding the summary and before the tool sees the args.
  let tokenConsumed = false;
  const argsForTool = { ...(parsed.data ?? {}) } as Record<string, unknown>;
  const confirmToken =
    typeof argsForTool.confirm_token === "string"
      ? argsForTool.confirm_token
      : undefined;
  delete argsForTool.confirm_token;

  if (tool.action) {
    const preflightError = tool.preflight?.(argsForTool, ctx) ?? null;
    if (preflightError) return finish(preflightError, true);

    const summary =
      (await tool.summarize?.(argsForTool, ctx)) ?? `Run ${tool.name}.`;

    if (!confirmToken) {
      const token = newConfirmToken();
      const stored = await storeConfirmBinding(token, {
        keyId: ctx.keyId,
        tool: tool.name,
        args: canonicalJson(argsForTool),
      });
      if (!stored) {
        return finish(
          "Could not store the confirmation (Valkey unavailable). Try again in a moment.",
          true,
        );
      }
      return finish(
        {
          confirmation_required: true,
          summary,
          confirm_token: token,
          expires_in_s: CONFIRM_TTL_SECONDS,
          next: CONFIRM_NEXT.replace(
            "this confirm_token",
            `confirm_token "${token}"`,
          ),
        },
        false,
      );
    }

    // Budget before the token take: GETDEL is irreversible, so a refused
    // action must not burn the confirmation. One count per confirmed attempt;
    // the summary call above stays free so a forgotten confirmation isn't
    // punished.
    const verdict = await checkMcpRateLimit(ctx.keyId, "action");
    if (!verdict.allowed) {
      return finish(
        rateLimitMessage("action", verdict.retryAfterSeconds),
        true,
      );
    }

    const binding = await takeConfirmBinding(confirmToken);
    const mismatch =
      binding === null
        ? "This confirm_token is unknown, expired or already used."
        : binding.keyId !== ctx.keyId ||
            binding.tool !== tool.name ||
            binding.args !== canonicalJson(argsForTool)
          ? "This confirm_token was issued for different arguments."
          : null;
    if (mismatch) {
      return finish(
        `${mismatch} ${TOKEN_USED_UP(tool.name)} Start over: show the new summary to the person, then call again with the fresh token.`,
        true,
      );
    }
    tokenConsumed = true;
  } else {
    const verdict = await checkMcpRateLimit(ctx.keyId, "read");
    if (!verdict.allowed) {
      return finish(rateLimitMessage("read", verdict.retryAfterSeconds), true);
    }
  }

  try {
    const result = await tool.run(argsForTool, ctx);
    return finish(capToolResult(result), false);
  } catch (error) {
    const message =
      error instanceof ToolFailure
        ? error.message
        : "The tool failed unexpectedly while talking to Rawkoon.";
    return finish(
      tokenConsumed ? `${message} ${TOKEN_USED_UP(tool.name)}` : message,
      true,
    );
  }
}

// ---------------------------------------------------------------------------
// initialize

export interface InitializeResult {
  protocolVersion: string;
  capabilities: { tools: {} };
  serverInfo: { name: string; version: string };
  instructions: string;
}

export const SERVER_INSTRUCTIONS =
  "Rawkoon: a self-hosted movie, TV show and book library. Read tools search and " +
  "inspect the library, requests and downloads; ACTION tools (request_title, decide_request) " +
  "work in two steps: the first call returns a summary and a confirm_token — show the summary " +
  "to the person, and call the same tool again with that token to perform the action. " +
  "Tools marked admin need an admin API-key owner.";

/** Negotiated in the route from the versions the server supports. */
export const MCP_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export function initializeResult(
  clientVersion: string | undefined,
): InitializeResult {
  const supported =
    clientVersion &&
    (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(clientVersion)
      ? clientVersion
      : MCP_PROTOCOL_VERSIONS[0];
  return {
    protocolVersion: supported,
    capabilities: { tools: {} },
    serverInfo: { name: "rawkoon", version: getAppVersion() },
    instructions: SERVER_INSTRUCTIONS,
  };
}
