import { existsSync } from "node:fs";
import type { Hono } from "hono";
import { serveStatic } from "hono/bun";

import { notFound } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { isApiPath } from "@rawkoon/api/utils/isApiPath";
import { resolveUser } from "@rawkoon/api/middleware/auth";

// The production image copies the built frontend into ./public (see Dockerfile);
// in dev the directory doesn't exist and Vite serves the SPA.
const serveStaticEnabled = existsSync("./public/index.html");
const spaIndexHtmlPromise: Promise<string> = serveStaticEnabled
  ? Bun.file("./public/index.html").text()
  : Promise.resolve("");

// U+2028/U+2029 are valid in JSON strings but break inline <script> parsing.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

function escapeInlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(LINE_SEP, "\\u2028")
    .replaceAll(PARA_SEP, "\\u2029");
}

// Serves the built SPA and its assets in production; a no-op in dev (Vite serves
// them). Registered last so it only catches requests no API route claimed.
export function registerStaticRoutes(app: Hono<Env>): void {
  if (!serveStaticEnabled) return;

  const assetStatic = serveStatic({
    root: "./public",
    precompressed: true,
    onFound: (_path, c) => {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    },
  });
  app.get("/assets/*", assetStatic);

  // The SPA shell owns "/" and any *.html; other real files (favicon, manifest,
  // sw.js) are served statically, and misses fall through to the shell.
  const otherStatic = serveStatic({ root: "./public" });
  app.use("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname === "/" || pathname.endsWith(".html")) return next();
    return otherStatic(c, next);
  });

  app.get("*", async (c) => {
    // An unmatched /api path is a bug, not a client route. Falling through to the
    // SPA answered 200 with HTML, which hid real failures (e.g. epub.js probing
    // /api/books/files/1/META-INF/container.xml got the shell and failed to parse).
    if (isApiPath(new URL(c.req.url).pathname)) {
      return notFound("Not found");
    }

    const [indexHtml, user] = await Promise.all([
      spaIndexHtmlPromise,
      resolveUser(c.req.raw).catch(() => null),
    ]);

    const bootScript = `<script>window.__RAWKOON_BOOTSTRAP__=${escapeInlineScriptJson({ user })};</script>`;
    const html = indexHtml.replace("</body>", `${bootScript}\n</body>`);

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });
}
