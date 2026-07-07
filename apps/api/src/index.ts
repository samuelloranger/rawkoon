import * as nodePath from "node:path";
import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { staticPlugin } from "@elysiajs/static";

import { cors } from "@elysiajs/cors";
import { checkAndNotifyVersionChange } from "./services/versionService";
import { auth as betterAuthInstance } from "@rawkoon/api/lib/auth";
import {
  protectedAuthRoutes,
  publicAuthRoutes,
  ssoProvidersRoute,
} from "./auth";
import { adminRoutes } from "./routes/admin";
import { dashboardRoutes } from "./routes/dashboard";
import { libraryMediaAdminRoutes } from "./routes/library/libraryMediaAdmin";
import { libraryDownloadsRoutes } from "./routes/library/downloads";
import { libraryRoutes } from "./routes/library";
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
import { webhooksRoutes } from "./routes/webhooks";
import { globalRateLimit, strictAuthRateLimit } from "./middleware/rateLimit";
import { resolveUser } from "./middleware/auth";
import { initWorkers, setupScheduledJobs } from "./services/queueService";

const serveStatic = Bun.env.SERVE_STATIC === "true";
const spaIndexHtmlPromise: Promise<string> = serveStatic
  ? Bun.file("./public/index.html").text()
  : Promise.resolve("");

function escapeInlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export const app = new Elysia()
  // Serve pre-compressed .gz assets built by vite-plugin-compression2 when client accepts gzip.
  .onAfterHandle({ as: "global" }, async ({ request, response, path }) => {
    if (!(response instanceof Response)) return;
    if (!path.startsWith("/assets/")) return;
    // Re-check after normalizing so paths like /assets/../../etc/passwd don't
    // resolve outside ./public when interpolated into the file path below.
    const safePath = nodePath.posix.normalize(path);
    if (!safePath.startsWith("/assets/")) return;
    const ext = safePath.split(".").pop() ?? "";
    if (ext !== "js" && ext !== "css") return;
    if ((request.headers.get("accept-encoding") ?? "").indexOf("gzip") === -1)
      return;
    if (response.headers.get("content-encoding")) return;

    const gzFile = Bun.file(`./public${safePath}.gz`);
    if (!(await gzFile.exists())) return;

    const ct = ext === "css" ? "text/css" : "application/javascript";
    return new Response(gzFile, {
      headers: {
        "Content-Type": ct,
        "Content-Encoding": "gzip",
        "Cache-Control": "public, max-age=31536000, immutable",
        Vary: "Accept-Encoding",
      },
    });
  })
  .use(
    cors({
      origin: Bun.env.CORS_ORIGIN || "http://localhost:5173", // Frontend URL
      credentials: true,
    }),
  )
  .use(Bun.env.NODE_ENV !== "production" ? swagger() : new Elysia())
  .use((app) => {
    console.log("Elysia app initialized");
    if (Bun.env.LOG_LEVEL === "debug") {
      app.on("beforeHandle", (context) => {
        console.log(
          `Incoming request: ${context.request.method} ${context.path}`,
        );
      });
    }
    return app;
  })
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
  .use(protectedAuthRoutes)
  .get("/api/auth/*", ({ request }) => betterAuthInstance.handler(request))
  .all("/api/auth/*", ({ request }) => betterAuthInstance.handler(request))
  .use(globalRateLimit) // Global rate limiting for unauthenticated requests
  .use(dashboardRoutes)
  .use(usersRoutes)
  .use(notificationsRoutes)
  .use(webhooksRoutes)
  .use(labbyRoutes)
  .use(releasesRoutes)
  .use(settingsRoutes)
  .use(adminRoutes)
  .use(integrationsRoutes)
  .use(libraryMediaAdminRoutes)
  .use(libraryDownloadsRoutes)
  .use(libraryRoutes)
  .use(qualityProfilesRoutes)
  .use(customFormatsRoutes)
  .use(mediasRoutes)
  .use(requestRoutes)
  .use(searchRoutes)
  .use(systemRoutes)
  .get("/health", () => ({ status: "ok" }))
  .get("/api/health", () => ({ status: "ok" }))
  .use((app) => {
    if (serveStatic) {
      // On Bun, @elysiajs/static imports .html as modules; Vite's index.html is plain HTML, so those routes
      // return empty bodies. Ignore *.html here and serve the SPA shell via Bun.file below.
      app
        .use(
          staticPlugin({
            assets: "./public",
            prefix: "/",
            // html served below with bootstrap injection
            ignorePatterns: [/\.html$/],
          }),
        )
        .get("*", async ({ request }) => {
          const [indexHtml, user] = await Promise.all([
            spaIndexHtmlPromise,
            resolveUser(request).catch(() => null),
          ]);

          const bootScript = `<script>window.__RAWKOON_BOOTSTRAP__=${escapeInlineScriptJson({ user })};</script>`;
          const html = indexHtml.replace("</body>", `${bootScript}\n</body>`);

          return new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        });
    }
    return app;
  });

if (import.meta.main) {
  // 1. Initialize BullMQ Workers
  initWorkers();

  // 2. Setup Scheduled Tasks (Crons)
  setupScheduledJobs().catch((err) => {
    console.error("Failed to setup scheduled jobs:", err);
  });

  // 3. Start Server
  app.listen(process.env.API_PORT || 3000);
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
  );

  // 4. Post-startup tasks
  checkAndNotifyVersionChange().catch((err) => {
    console.error("Failed to check version change after startup:", err);
  });
}
