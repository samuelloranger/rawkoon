/**
 * A rate limiter mounted inside one router must not police the rest of the app.
 *
 * elysia-rate-limit defaults `scoping` to "global", so a limiter declared inside
 * a sub-router registers its `onBeforeHandle` on every route in the application.
 * The download-client hook limiter (120 requests a minute, per IP, with no
 * authenticated bypass) therefore capped the whole API: opening a book fires a
 * burst of app, asset and API requests, and everything after the 120th came
 * back 429 — including the SPA document and its JavaScript.
 */
import { describe, it, expect, mock } from "bun:test";

let sessionExists = true;

mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: {
      getSession: () =>
        Promise.resolve(sessionExists ? { user: { id: "u1" } } : null),
    },
    handler: () => Promise.resolve(new Response("", { status: 404 })),
  },
  refreshOidcProviders: () => {},
}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadClient: { findMany: () => Promise.resolve([]) },
    downloadHistory: { findFirst: () => Promise.resolve(null) },
  },
}));

const { Elysia } = await import("elysia");
const { downloadClientHookRoutes } = await import(
  "@rawkoon/api/routes/integrations/downloadClient/hookRoutes"
);
const { globalRateLimit } = await import("@rawkoon/api/middleware/rateLimit");

const HOOK_LIMIT = 120;

const buildApp = () =>
  new Elysia()
    .use(downloadClientHookRoutes)
    // Stands in for every other route in the application.
    .get("/api/books", () => ({ books: [] }));

const call = (app: ReturnType<typeof buildApp>, path: string, ip: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      headers: { "x-forwarded-for": ip },
    }),
  );

describe("download-client hook rate limit", () => {
  it("does not limit unrelated routes once the hook budget is spent", async () => {
    const app = buildApp();
    let last = 0;

    // Comfortably past the hook limiter's per-minute budget.
    for (let i = 0; i < HOOK_LIMIT + 20; i++) {
      last = (await call(app, "/api/books", "203.0.113.10")).status;
    }

    expect(last).toBe(200);
  });

  it("still limits its own hook endpoint", async () => {
    // The endpoint is unauthenticated and reachable by anything that learns the
    // URL, so it must stay limited. Asserted through the limiter's own headers
    // rather than by exhausting the budget: the plugin does not count failed
    // requests, and this endpoint rejects a bad token.
    const app = buildApp();

    const hook = await app.handle(
      new Request("http://localhost/api/download-client/hook/complete", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.20",
          "x-rawkoon-token": "nope",
        },
      }),
    );
    const other = await call(app, "/api/books", "203.0.113.20");

    expect(hook.headers.get("ratelimit-limit")).toBe(String(HOOK_LIMIT));
    expect(other.headers.get("ratelimit-limit")).toBeNull();
  });
});

describe("global rate limit", () => {
  const GLOBAL_LIMIT = 1000;

  const app = new Elysia()
    .use(globalRateLimit)
    .get("/api/books", () => ({ books: [] }));

  const request = (ip: string, cookie?: string) =>
    app.handle(
      new Request("http://localhost/api/books", {
        headers: cookie
          ? { "x-forwarded-for": ip, cookie }
          : { "x-forwarded-for": ip },
      }),
    );

  it("never limits a signed-in session", async () => {
    sessionExists = true;
    let last = 0;

    // Well past the budget an anonymous visitor gets. A reading or listening
    // session is request-heavy by nature — Range requests, progress writes, an
    // SSE reconnect — and none of it should ever hit a limit.
    for (let i = 0; i < GLOBAL_LIMIT + 50; i++) {
      last = (await request("203.0.113.30", "better-auth.session_token=abc"))
        .status;
    }

    expect(last).toBe(200);
  });

  it("keeps limiting requests with no session", async () => {
    sessionExists = false;
    let sawLimit = false;

    for (let i = 0; i < GLOBAL_LIMIT + 5; i++) {
      const res = await request("203.0.113.40");
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }

    expect(sawLimit).toBe(true);
  });
});
