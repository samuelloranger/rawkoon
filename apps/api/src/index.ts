import { existsSync } from "node:fs";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";

import { notFound, ok } from "@rawkoon/api/errors";
import { type Env, honoOnError } from "@rawkoon/api/honoEnv";
import { isApiPath } from "@rawkoon/api/utils/isApiPath";

import { checkAndNotifyVersionChange } from "./services/versionService";
import { auth as betterAuthInstance } from "@rawkoon/api/lib/auth";
import {
  protectedAuthRoutes,
  publicAuthRoutes,
  ssoProvidersRoute,
  mobileAuthRoutes,
} from "./auth";
import { downloadClientHookRoutes } from "./routes/integrations/downloadClient/hookRoutes";
import { adminRoutes } from "./routes/admin";
import { dashboardRoutes } from "./routes/dashboard";
import { libraryRoutes } from "./routes/library";
import {
  bookRoutes,
  bookQualityProfileRoutes,
  authorRoutes,
} from "./routes/books";
import { qualityProfilesRoutes } from "./routes/quality-profiles";
import { customFormatsRoutes } from "./routes/custom-formats";
import { mediasRoutes } from "./routes/medias";
import { requestRoutes } from "./routes/requests";
import { notificationsRoutes } from "./routes/notifications";
import { integrationsRoutes } from "./routes/integrations";
import { labbyRoutes } from "./routes/labby";
import { releasesRoutes } from "./routes/releases";
import { searchRoutes } from "./routes/search";
import { settingsRoutes } from "./routes/settings";
import { systemRoutes } from "./routes/system";
import { usersRoutes } from "./routes/users";
// Hono edge middleware; the Elysia strict-auth limiter lives in the auth island.
import { globalRateLimit } from "./middleware/hono/rateLimit";
import { requestTiming } from "./middleware/hono/requestTiming";
import { strictAuthRateLimit } from "./middleware/rateLimit";
import { resolveUser } from "./middleware/auth";
import {
  closeAllWorkers,
  initWorkers,
  setupScheduledJobs,
} from "./services/queueService";
import { startResourceSampler } from "./services/perf/perfStore";
import { checkHealth } from "./services/healthCheck";

// The production image copies the built frontend into ./public (see
// Dockerfile); in dev the directory doesn't exist and Vite serves the SPA.
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

// better-auth, the /api/auth/* delegation, the auth.ts routers, and the
// download-client webhook stay on Elysia (out of scope for the Hono migration).
// They live in this island, bridged from the Hono edge below. Its onError
// mirrors the original edge so auth-route error shapes are unchanged.
const authIsland = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "Not found" };
    }
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: error.message };
    }
    console.error(`[${code}] Unhandled error:`, error);
    set.status = 500;
    return { error: "Internal server error" };
  })
  .use(strictAuthRateLimit)
  .use(publicAuthRoutes)
  .use(ssoProvidersRoute)
  .use(mobileAuthRoutes)
  .use(protectedAuthRoutes)
  .all("/api/auth/*", ({ request }) => betterAuthInstance.handler(request))
  .use(downloadClientHookRoutes);

const bridgeToAuthIsland = (c: { req: { raw: Request } }): Promise<Response> =>
  authIsland.handle(c.req.raw);

// strict:false so a trailing slash matches (`/api/requests/` == `/api/requests`),
// preserving Elysia's lenient routing across every mounted domain router.
export const app = new Hono<Env>({ strict: false });

// cors + perf timing wrap everything (registered first → apply to all routes).
app.use(
  "*",
  cors({
    origin: Bun.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use("*", requestTiming);

if (Bun.env.LOG_LEVEL === "debug") {
  app.use("*", async (c, next) => {
    console.log(
      `Incoming request: ${c.req.method} ${new URL(c.req.url).pathname}`,
    );
    await next();
  });
}

app.onError(honoOnError);
app.notFound(() => notFound("Not found"));

// Auth + hooks island (registered before the global limiter so it is not also
// rate-limited by it; the strict auth limiter lives inside the island).
app.all("/api/auth/*", bridgeToAuthIsland);
app.all("/api/mobile/*", bridgeToAuthIsland);
app.all("/api/download-client/*", bridgeToAuthIsland);

// Global rate limiting applies to everything registered after this point
// (domains, health, static) — unauthenticated requests only; see rateLimitCore.
app.use("*", globalRateLimit);

app
  .route("/api/dashboard", dashboardRoutes)
  .route("/api/users", usersRoutes)
  .route("/api/notifications", notificationsRoutes)
  .route("/api/labby", labbyRoutes)
  .route("/api/releases", releasesRoutes)
  .route("/api/settings", settingsRoutes)
  .route("/api/admin", adminRoutes)
  .route("/api/integrations", integrationsRoutes)
  // libraryMediaAdmin + libraryDownloads are folded into libraryRoutes (all three
  // share /api/library, and only one router can own that prefix).
  .route("/api/library", libraryRoutes)
  .route("/api/books", bookRoutes)
  .route("/api/book-quality-profiles", bookQualityProfileRoutes)
  .route("/api/authors", authorRoutes)
  .route("/api/quality-profiles", qualityProfilesRoutes)
  .route("/api/custom-formats", customFormatsRoutes)
  .route("/api/medias", mediasRoutes)
  .route("/api/requests", requestRoutes)
  .route("/api/search", searchRoutes)
  .route("/api/system", systemRoutes);

app.get("/api/health", async (c) => {
  const health = await checkHealth();
  return ok(health, health.status === "degraded" ? 503 : 200);
});

if (serveStaticEnabled) {
  // Pre-compressed .gz assets are served natively by serveStatic (precompressed).
  const assetStatic = serveStatic({
    root: "./public",
    precompressed: true,
    onFound: (_path, c) => {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    },
  });
  app.get("/assets/*", assetStatic);

  // Other real files (favicon, manifest, sw.js) are served statically; the SPA
  // shell (with bootstrap injection) owns "/" and any *.html, and misses fall
  // through to it.
  const otherStatic = serveStatic({ root: "./public" });
  app.use("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname === "/" || pathname.endsWith(".html")) return next();
    return otherStatic(c, next);
  });

  app.get("*", async (c) => {
    // An unmatched /api path is a bug, not a client-side route. Falling through
    // to the SPA answered 200 with HTML, which hid a real failure: epub.js
    // probed `/api/books/files/1/META-INF/container.xml`, got the shell with a
    // success status, and silently failed to parse it.
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

if (import.meta.main) {
  // 1. Initialize BullMQ Workers
  initWorkers();

  // 1b. Perf-baseline CPU/RSS sampler (no-op unless PERF_TIMING_ENABLED=true)
  startResourceSampler();

  // 2. Setup Scheduled Tasks (Crons)
  setupScheduledJobs().catch((err) => {
    console.error("Failed to setup scheduled jobs:", err);
  });

  // 3. Start Server
  const server = Bun.serve({
    fetch: app.fetch,
    port: Number(process.env.API_PORT || 3000),
    idleTimeout: 0,
  });
  console.log(`🔥 Hono is running at ${server.hostname}:${server.port}`);

  // 4. Post-startup tasks
  checkAndNotifyVersionChange().catch((err) => {
    console.error("Failed to check version change after startup:", err);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);
    try {
      await closeAllWorkers();
      server.stop();
    } catch (err) {
      console.error("Shutdown error:", err);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
