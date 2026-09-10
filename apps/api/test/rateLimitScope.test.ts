/**
 * A rate limiter mounted for one route must not police the rest of the app.
 *
 * The download-client hook limiter (120 requests a minute, per IP, with no
 * authenticated bypass) must stay scoped to its own route: otherwise it caps the
 * whole API — opening a book fires a burst of app, asset and API requests, and
 * everything after the 120th would come back 429, the SPA and its JavaScript
 * included. The hook limiter is therefore a route-level middleware, scoped to
 * its own route.
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

mock.module("@rawkoon/api/lib/apiKeyApi", () => ({
  apiKeyApi: {
    verifyApiKey: ({ body }: { body: { key: string } }) =>
      Promise.resolve({ valid: body.key === "valid-key" }),
  },
}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadClient: { findMany: () => Promise.resolve([]) },
    downloadHistory: { findFirst: () => Promise.resolve(null) },
  },
}));

const { Hono } = await import("hono");
const { downloadClientHookRoutes } = await import(
  "@rawkoon/api/routes/integrations/downloadClient/hookRoutes"
);
const { globalRateLimit } = await import(
  "@rawkoon/api/middleware/hono/rateLimit"
);

const HOOK_LIMIT = 120;

const buildApp = () =>
  new Hono()
    .route("/api/download-client", downloadClientHookRoutes)
    // Stands in for every other route in the application.
    .get("/api/books", (c) => c.json({ books: [] }));

const call = (app: ReturnType<typeof buildApp>, path: string, ip: string) =>
  app.request(
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

    const hook = await app.request(
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

  const app = new Hono()
    .use("*", globalRateLimit)
    .get("/api/books", (c) => c.json({ books: [] }));

  const request = (ip: string, cookie?: string) =>
    app.request(
      new Request("http://localhost/api/books", {
        headers: cookie
          ? { "x-forwarded-for": ip, cookie }
          : { "x-forwarded-for": ip },
      }),
    );

  it("never limits a Bearer session", async () => {
    sessionExists = true;
    const bearerApp = new Hono()
      .use("*", globalRateLimit)
      .get("/api/books", (c) => c.json({ books: [] }));
    let last = 0;
    for (let i = 0; i < GLOBAL_LIMIT + 50; i++) {
      last = (
        await bearerApp.request(
          new Request("http://localhost/api/books", {
            headers: {
              "x-forwarded-for": "203.0.113.50",
              authorization: "Bearer tok",
            },
          }),
        )
      ).status;
    }
    expect(last).toBe(200);
  });

  it("never limits an x-api-key request with a session", async () => {
    sessionExists = true;
    const keyApp = new Hono()
      .use("*", globalRateLimit)
      .get("/api/books", (c) => c.json({ books: [] }));
    let last = 0;
    for (let i = 0; i < GLOBAL_LIMIT + 50; i++) {
      last = (
        await keyApp.request(
          new Request("http://localhost/api/books", {
            headers: {
              "x-forwarded-for": "203.0.113.51",
              "x-api-key": "valid-key",
            },
          }),
        )
      ).status;
    }
    expect(last).toBe(200);
  });

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
