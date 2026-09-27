import { createMiddleware } from "hono/factory";

/**
 * Conditional GET for JSON API responses: tags every buffered 200 JSON body
 * with a weak ETag and answers a matching `If-None-Match` with an empty 304.
 *
 * Only plain JSON is touched — SSE, file/image/audio streams, ranges, and any
 * non-200 (401/403/429…) pass through unread, so nothing long-lived is ever
 * buffered.
 */

const JSON_MEDIA_TYPE = "application/json";
const DEFAULT_CACHE_CONTROL = "private, no-cache";
const ETAG_TOKEN = /(?:W\/)?"[^"]*"/g;

export function isJsonMediaType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";", 1)[0] ?? "";
  return mediaType.trim().toLowerCase() === JSON_MEDIA_TYPE;
}

/** Merges tokens into `Vary`, case-insensitively, leaving `Vary: *` alone. */
export function appendVary(headers: Headers, ...tokens: string[]): void {
  const current = headers.get("Vary");
  if (current?.trim() === "*") return;
  const values = current
    ? current
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
  const seen = new Set(values.map((v) => v.toLowerCase()));
  for (const token of tokens) {
    if (seen.has(token.toLowerCase())) continue;
    seen.add(token.toLowerCase());
    values.push(token);
  }
  headers.set("Vary", values.join(", "));
}

function weakEtag(body: Uint8Array): string {
  return `W/"${body.byteLength.toString(36)}-${Bun.hash(body).toString(36)}"`;
}

const opaqueTag = (tag: string) => (tag.startsWith("W/") ? tag.slice(2) : tag);

/** Weak comparison per RFC 9110 §13.1.2: `*` or any listed tag matches. */
export function ifNoneMatchHits(
  header: string | undefined,
  etag: string,
): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const target = opaqueTag(etag);
  return (header.match(ETAG_TOKEN) ?? []).some(
    (tag) => opaqueTag(tag) === target,
  );
}

function isTaggable(res: Response): boolean {
  if (res.status !== 200 || !res.body) return false;
  if (!isJsonMediaType(res.headers.get("Content-Type"))) return false;
  const h = res.headers;
  if (h.has("ETag") || h.has("Content-Encoding") || h.has("Content-Range")) {
    return false;
  }
  // A 304 must not swallow a rotated session cookie.
  if (h.has("Set-Cookie")) return false;
  return !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(h.get("Cache-Control") ?? "");
}

export const conditionalGet = createMiddleware(async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return;
  const res = c.res;
  if (!isTaggable(res)) return;

  const body = new Uint8Array(await res.arrayBuffer());
  const etag = weakEtag(body);
  const headers = new Headers(res.headers);
  headers.set("ETag", etag);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", DEFAULT_CACHE_CONTROL);
  }
  appendVary(headers, "Authorization");

  // Cleared first so Hono's res setter doesn't merge the old headers back in.
  c.res = undefined;
  if (ifNoneMatchHits(c.req.header("If-None-Match"), etag)) {
    headers.delete("Content-Type");
    headers.delete("Content-Length");
    c.res = new Response(null, { status: 304, headers });
    return;
  }
  c.res = new Response(body, {
    status: 200,
    statusText: res.statusText,
    headers,
  });
});
