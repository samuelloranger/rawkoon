import { createMiddleware } from "hono/factory";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import {
  appendVary,
  isJsonMediaType,
} from "@rawkoon/api/middleware/hono/conditionalGet";

/**
 * gzip/brotli for buffered 200 JSON API responses above a size threshold.
 * Everything else (SSE, files, ranges, non-200) passes through unread, which
 * `hono/compress` can't guarantee: it streams any "compressible" type and its
 * threshold only works when Content-Length is known (never for `Response.json`).
 */

export const COMPRESS_THRESHOLD_BYTES = 1024;

type Encoding = "br" | "gzip";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

// Quality 4 keeps per-request brotli near gzip cost; the default 11 is for static assets.
const BROTLI_OPTIONS = {
  params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
};

/** Picks br over gzip when both are acceptable; honours `q=0` and `*`. */
export function selectEncoding(header: string | undefined): Encoding | null {
  if (!header) return null;
  const q = new Map<string, number>();
  for (const part of header.split(",")) {
    const [rawToken, ...params] = part.split(";");
    const token = rawToken?.trim().toLowerCase();
    if (!token) continue;
    const qParam = params
      .map((p) => p.trim())
      .find((p) => p.toLowerCase().startsWith("q="));
    const value = qParam ? Number(qParam.slice(2)) : 1;
    q.set(token, Number.isFinite(value) ? value : 0);
  }
  const accepts = (enc: Encoding) => (q.get(enc) ?? q.get("*") ?? 0) > 0;
  if (accepts("br")) return "br";
  if (accepts("gzip")) return "gzip";
  return null;
}

function isCompressible(res: Response): boolean {
  if (res.status !== 200 || !res.body) return false;
  if (!isJsonMediaType(res.headers.get("Content-Type"))) return false;
  const h = res.headers;
  if (h.has("Content-Encoding") || h.has("Content-Range")) return false;
  return !/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(
    h.get("Cache-Control") ?? "",
  );
}

async function encode(body: Uint8Array, encoding: Encoding) {
  const out =
    encoding === "br"
      ? await brotliAsync(body, BROTLI_OPTIONS)
      : await gzipAsync(body);
  return new Uint8Array(out);
}

export const compressJson = createMiddleware(async (c, next) => {
  await next();
  // HEAD carries no body to compress.
  if (c.req.method !== "GET") return;
  const res = c.res;
  // A 304 must carry the same Vary as the 200 it stands in for.
  if (res.status === 304 && res.headers.has("ETag")) {
    appendVary(res.headers, "Accept-Encoding");
    return;
  }
  if (!isCompressible(res)) return;

  const body = new Uint8Array(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  appendVary(headers, "Accept-Encoding");

  const encoding = selectEncoding(c.req.header("Accept-Encoding"));
  let payload = body;
  if (encoding && body.byteLength > COMPRESS_THRESHOLD_BYTES) {
    payload = await encode(body, encoding);
    headers.set("Content-Encoding", encoding);
  }
  // Bun recomputes it from the new body.
  headers.delete("Content-Length");

  c.res = undefined;
  c.res = new Response(payload, {
    status: 200,
    statusText: res.statusText,
    headers,
  });
});
