import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

mock.module("@rawkoon/api/db", () => ({
  prisma: { integration: { findFirst: async () => null } },
}));

const { Hono } = await import("hono");
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
afterEach(() => fetchSpy?.mockRestore());

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
