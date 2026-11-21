import type { MappedUser } from "@rawkoon/api/honoEnv";
import type { McpScope } from "@rawkoon/shared/types";
import type { ZodType } from "zod";
import { dispatchAsUser } from "./dispatcher";
import { innerFailureText, readInnerError } from "./shape";
import type { McpCaller } from "./auth";

export type McpToolContext = McpCaller;

/** Thrown by tools as a plain-English failure; becomes isError, never -32xxx. */
export class ToolFailure extends Error {}

export interface McpTool {
  name: string;
  scope: McpScope;
  /** ACTION tools need the two-step confirm before their side effect runs. */
  action: boolean;
  description: string;
  inputSchema: Record<string, unknown>;
  args: ZodType;
  /**
   * ACTION tools only: argument checks that need the caller (owner role).
   * A returned string fails the call before any confirm token is issued.
   */
  preflight?: (args: unknown, ctx: McpToolContext) => string | null;
  /** ACTION tools only: the human-facing summary of what will happen. */
  summarize?: (args: unknown, ctx: McpToolContext) => string | Promise<string>;
  run: (args: unknown, ctx: McpToolContext) => Promise<unknown>;
}

type InnerOutcome =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; text: string };

/** One inner dispatch as the key owner; failures carry plain-English text. */
export async function inner(
  request: Request,
  owner: MappedUser,
): Promise<InnerOutcome> {
  const res = await dispatchAsUser(request, owner);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      text: innerFailureText(res, await readInnerError(res)),
    };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: true, status: res.status, body };
}

// Narrow JSON readers so tool shaping stays defensive against route changes.
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
