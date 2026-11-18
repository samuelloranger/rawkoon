import { setJsonCache, takeJsonCache } from "@rawkoon/api/services/cache";

/** Confirmations live 5 minutes; the token is 128 bits of CSPRNG output. */
export const CONFIRM_TTL_SECONDS = 300;

const confirmKey = (token: string) => `mcp:confirm:${token}`;

export interface ConfirmBinding {
  keyId: string;
  tool: string;
  /** Canonical (sorted-keys) JSON of the tool arguments, token-bound. */
  args: string;
}

export function canonicalJson(value: unknown): string {
  // Sorting keys makes the binding stable against harmless object key order
  // changes between the summary call and the confirmed call.
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function newConfirmToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fails closed: no Valkey means no performed actions. */
export async function storeConfirmBinding(
  token: string,
  binding: ConfirmBinding,
): Promise<boolean> {
  await setJsonCache(confirmKey(token), binding, CONFIRM_TTL_SECONDS);
  return true;
}

/**
 * Single-use take: GETDEL removes the binding atomically. Returns null when
 * the token is unknown or expired; callers report "start over".
 */
export function takeConfirmBinding(
  token: string,
): Promise<ConfirmBinding | null> {
  return takeJsonCache<ConfirmBinding>(confirmKey(token));
}
