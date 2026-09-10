import { Hono } from "hono";
import { cors } from "hono/cors";

import { notFound, ok } from "@rawkoon/api/errors";
import { type Env, honoOnError } from "@rawkoon/api/honoEnv";

import { registerStaticRoutes } from "./staticRoutes";
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
import {
  globalRateLimit,
  strictAuthRateLimit,
} from "./middleware/hono/rateLimit";
import { requestTiming } from "./middleware/hono/requestTiming";
import {
  closeAllWorkers,
  initWorkers,
  setupScheduledJobs,
} from "./services/queueService";
import { startResourceSampler } from "./services/perf/perfStore";
import { checkHealth } from "./services/healthCheck";

// strict:false so a trailing slash matches (`/api/requests/` == `/api/requests`)
// across every mounted domain router.
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

// Strict auth limiter — counts only sign-in / sign-up / accept-invitation (its
// skip predicate), registered early so it wraps the auth routes and better-auth
// delegation but not the domains (which get the global limiter below).
app.use("*", strictAuthRateLimit);

// Auth routes. better-auth (lib/auth) is framework-agnostic — only the route
// wiring is Hono. The specific auth.ts routes are registered BEFORE the
// better-auth catch-all so Hono doesn't swallow them into `/api/auth/*`.
app.route("/", publicAuthRoutes);
app.route("/", ssoProvidersRoute);
app.route("/", mobileAuthRoutes);
app.route("/", protectedAuthRoutes);
app.all("/api/auth/*", (c) => betterAuthInstance.handler(c.req.raw));
app.route("/api/download-client", downloadClientHookRoutes);

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

registerStaticRoutes(app);

if (import.meta.main) {
  initWorkers();

  // Perf-baseline CPU/RSS sampler (no-op unless PERF_TIMING_ENABLED=true)
  startResourceSampler();

  setupScheduledJobs().catch((err) => {
    console.error("Failed to setup scheduled jobs:", err);
  });

  const server = Bun.serve({
    fetch: app.fetch,
    port: Number(process.env.API_PORT || 3000),
    idleTimeout: 0,
  });
  console.log(`🔥 Hono is running at ${server.hostname}:${server.port}`);

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
