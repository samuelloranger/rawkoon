/**
 * Result caps shared by every tool: strings stay short enough for a model
 * context, lists carry a truncation flag and total so the AI knows to narrow
 * its query instead of assuming the list is complete.
 */
const MAX_STRING_CHARS = 300;
const MAX_LIST_ITEMS = 25;

export function capString(value: string): string {
  if (value.length <= MAX_STRING_CHARS) return value;
  return `${value.slice(0, MAX_STRING_CHARS - 1)}…`;
}

/**
 * Recursively caps a JSON-shaped result:
 * - strings longer than 300 chars are cut to 299 + an ellipsis;
 * - arrays longer than 25 keep their first 25 entries; the object holding the
 *   array gains `truncated: true` and `total: n`; a top-level array result
 *   becomes `{ items, truncated, total }`.
 */
export function capToolResult(value: unknown): unknown {
  return capValue(value);
}

function capValue(value: unknown): unknown {
  if (typeof value === "string") return capString(value);
  if (Array.isArray(value)) {
    const capped = value.map(capValue);
    if (capped.length <= MAX_LIST_ITEMS) return capped;
    return {
      items: capped.slice(0, MAX_LIST_ITEMS),
      truncated: true,
      total: capped.length,
    };
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) out[k] = capValue(v);
    return out;
  }
  return value;
}

/** Lists an inner route returns are capped here with the standard flag. */
export function capList(items: unknown[]): {
  items: unknown[];
  truncated: boolean;
  total: number;
} {
  return {
    items: items.slice(0, MAX_LIST_ITEMS),
    truncated: items.length > MAX_LIST_ITEMS,
    total: items.length,
  };
}

/** Reads `{ error }` from an inner route response; null when not JSON. */
export async function readInnerError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * Maps a non-2xx inner response to the plain-English text a tool failure
 * carries (isError: true), never a JSON-RPC protocol error.
 */
export function innerFailureText(
  res: Response,
  innerError: string | null,
): string {
  const detail = innerError ? ` (${innerError})` : "";
  switch (res.status) {
    case 400:
    case 422:
      return `Rawkoon rejected the request${detail}.`;
    case 401:
      // Should be unreachable: the inner request acts as the key owner.
      return "The inner request was not authenticated. This is a Rawkoon bug; report it.";
    case 403:
      return `This API key's owner is not allowed to do that${detail}. Admin access is required.`;
    case 404:
      return `Not found${detail}.`;
    case 409:
      return `Conflict${detail}. The title may already be requested or in the library.`;
    case 429:
      return "Rawkoon rate-limited the inner request. Wait a moment and retry.";
    default:
      return `Rawkoon failed to process the request (status ${res.status}).`;
  }
}
