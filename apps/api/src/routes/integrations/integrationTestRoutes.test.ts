import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

let storedRow: { enabled: boolean; config: unknown } | null = null;
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    integration: { findFirst: async () => storedRow },
    oidcProvider: { findMany: async () => [] },
  },
}));

let current: { id: string; is_admin: boolean } | null = null;
mock.module("@rawkoon/api/middleware/auth", () => ({
  resolveUser: async () => current,
}));

const { Hono } = await import("hono");
const { encrypt } = await import("@rawkoon/api/services/crypto");
const { integrationsRoutes } = await import("./index");
const { jackettIntegrationRoutes } = await import("./jackett");
const { prowlarrIntegrationRoutes } = await import("./prowlarr");
const { jellyfinIntegrationRoutes } = await import("./jellyfin");
const { tmdbIntegrationRoutes } = await import("./tmdb");

const KEY = "super-secret-key";

const cases = [
  {
    name: "jackett",
    routes: jackettIntegrationRoutes,
    body: { website_url: "http://jackett.test", api_key: KEY },
    ok: () => new Response("<indexers></indexers>"),
  },
  {
    name: "prowlarr",
    routes: prowlarrIntegrationRoutes,
    body: { website_url: "http://prowlarr.test", api_key: KEY },
    ok: () => Response.json([]),
  },
  {
    name: "jellyfin",
    routes: jellyfinIntegrationRoutes,
    body: { website_url: "http://jellyfin.test", api_key: KEY },
    ok: () => Response.json({}),
  },
  {
    name: "tmdb",
    routes: tmdbIntegrationRoutes,
    body: { api_key: KEY },
    ok: () => Response.json({}),
  },
] as const;

const networkError = (code: string) =>
  new TypeError("fetch failed", { cause: { code } });

let fetchSpy: ReturnType<typeof spyOn> | null = null;
function stubFetch(impl: () => Response | Promise<Response>) {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () =>
    impl()) as unknown as typeof fetch);
}
afterEach(() => {
  fetchSpy?.mockRestore();
  storedRow = null;
  current = null;
});

const post = (
  routes: (typeof cases)[number]["routes"],
  name: string,
  body: unknown,
) =>
  new Hono().route("/", routes).fetch(
    new Request(`http://localhost/${name}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

for (const { name, routes, body, ok } of cases) {
  describe(`POST /api/integrations/${name}/test`, () => {
    it("reports success", async () => {
      stubFetch(ok);
      const res = await post(routes, name, body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    });

    it.each([
      ["ENOTFOUND", "dns"],
      ["ECONNREFUSED", "refused"],
    ])("classifies %s as %s", async (code, cause) => {
      stubFetch(() => {
        throw networkError(code);
      });
      const res = await post(routes, name, body);
      const json = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(json.success).toBe(false);
      expect(json.cause).toBe(cause);
      expect(String(json.message)).toContain("Could not connect to");
      expect(JSON.stringify(json)).not.toContain(KEY);
    });

    it("classifies a 401 as an auth failure", async () => {
      stubFetch(() => new Response("nope", { status: 401 }));
      const json = (await (await post(routes, name, body)).json()) as Record<
        string,
        unknown
      >;
      expect(json.success).toBe(false);
      expect(json.cause).toBe("auth");
      expect(JSON.stringify(json)).not.toContain(KEY);
    });

    it("is a 400 when there is nothing to test", async () => {
      const res = await post(routes, name, {});
      expect(res.status).toBe(400);
    });
  });
}

describe("jackett torznab errors", () => {
  it("treats a 200 + <error code=100> as a rejected key", async () => {
    stubFetch(
      () => new Response('<error code="100" description="Invalid API Key" />'),
    );
    const res = await post(jackettIntegrationRoutes, "jackett", cases[0].body);
    expect(((await res.json()) as { cause: string }).cause).toBe("auth");
  });
});

describe("stored key is only sent to the stored URL", () => {
  const STORED_KEY = "stored-secret";
  const store = () => {
    storedRow = {
      enabled: true,
      config: {
        website_url: "http://saved.test",
        api_key: encrypt(STORED_KEY),
        rss_indexers: [],
      },
    };
  };
  const seen = () =>
    (fetchSpy?.mock.calls ?? []).map((call: unknown[]) => JSON.stringify(call));

  for (const name of ["jackett", "prowlarr", "jellyfin"] as const) {
    const routes = cases.find((c) => c.name === name)!.routes;
    const ok = cases.find((c) => c.name === name)!.ok;

    it(`${name}: a different URL with a blank key is a 400 and sends nothing`, async () => {
      store();
      stubFetch(ok);
      const res = await post(routes, name, {
        website_url: "http://other.example",
      });
      expect(res.status).toBe(400);
      expect(fetchSpy?.mock.calls.length).toBe(0);
    });

    it(`${name}: the same URL (trailing slash ignored) uses the stored key`, async () => {
      store();
      stubFetch(ok);
      const res = await post(routes, name, {
        website_url: "http://saved.test/",
      });
      expect(await res.json()).toEqual({ success: true });
      expect(seen().join()).toContain(STORED_KEY);
    });

    it(`${name}: a different URL with a typed key tests that key`, async () => {
      store();
      stubFetch(ok);
      await post(routes, name, {
        website_url: "http://other.example",
        api_key: "typed",
      });
      expect(seen().join()).toContain("typed");
      expect(seen().join()).not.toContain(STORED_KEY);
    });
  }
});

describe("the test routes are admin-only", () => {
  const app = new Hono().route("/api/integrations", integrationsRoutes);
  for (const { name, body } of cases) {
    it(`${name}: 403 for a non-admin, 401 when signed out`, async () => {
      stubFetch(() => Response.json({}));
      const send = () =>
        app.fetch(
          new Request(`http://localhost/api/integrations/${name}/test`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        );
      current = { id: "member", is_admin: false };
      expect((await send()).status).toBe(403);
      current = null;
      expect((await send()).status).toBe(401);
      expect(fetchSpy?.mock.calls.length).toBe(0);
    });
  }
});
