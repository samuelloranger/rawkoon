import { beforeEach, describe, expect, it, mock } from "bun:test";

const jellyfinConfig = { website_url: "http://jellyfin.test", api_key: "k" };

let currentUser: Record<string, unknown> | null = null;
const findUnique = mock(async () => currentUser);
const getJellyfinConfig = mock(
  async (): Promise<typeof jellyfinConfig | null> => jellyfinConfig,
);
const authorizeJellyfinQuickConnect = mock(
  async (): Promise<"ok" | "unknown_code"> => "ok",
);
const getIntegrationConfigRecord = mock(
  async (): Promise<Record<string, unknown> | null> => ({
    enabled: true,
    config: { api_key: "tmdb-key" },
  }),
);

mock.module("@rawkoon/api/db", () => ({
  prisma: { user: { findUnique } },
}));
mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireUser: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { id: "u1" });
    await next();
  },
}));
// mock.module is process-wide, so keep every export other suites import.
mock.module("@rawkoon/api/services/jellyfinUsers", () => ({
  JELLYFIN_SESSION_AGENT_PREFIX: "Jellyfin: ",
  jellyfinAuthHeader: (token: string) => ({
    Authorization: `MediaBrowser Token="${token}"`,
  }),
  getJellyfinConfig,
  resolveJellyfinTokenUser: async () => null,
  listJellyfinUsers: async () => [],
  authorizeJellyfinQuickConnect,
}));
mock.module("@rawkoon/api/services/integrationConfigCache", () => ({
  getIntegrationConfigRecord,
  invalidateIntegrationConfigCache: async () => {},
}));
const { tvRoutes } = await import("./index");

const linkedUser = {
  id: "u1",
  name: "Viewer",
  firstName: null,
  email: "viewer@example.com",
  isAdmin: false,
  jellyfinUserId: "jf-1",
};

const quickConnect = (code: unknown) =>
  tvRoutes.fetch(
    new Request("http://localhost/jellyfin/quick-connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );

describe("tv routes", () => {
  beforeEach(() => {
    currentUser = { ...linkedUser };
    getJellyfinConfig.mockClear();
    authorizeJellyfinQuickConnect.mockClear();
  });

  it("bootstraps the Jellyfin server and TMDB key", async () => {
    const res = await tvRoutes.fetch(new Request("http://localhost/bootstrap"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: "u1", name: "Viewer", is_admin: false },
      jellyfin: { url: "http://jellyfin.test", linked: true },
      tmdb: { key: "tmdb-key" },
    });
  });

  it("reports an unlinked account and missing integrations", async () => {
    currentUser = { ...linkedUser, jellyfinUserId: null };
    getIntegrationConfigRecord.mockImplementationOnce(async () => null);
    const res = await tvRoutes.fetch(new Request("http://localhost/bootstrap"));
    const json = (await res.json()) as any;
    expect(json.jellyfin).toEqual({
      url: "http://jellyfin.test",
      linked: false,
    });
    expect(json.tmdb).toBeNull();
  });

  it("approves Quick Connect for the linked Jellyfin user", async () => {
    const res = await quickConnect("123456");
    expect(res.status).toBe(200);
    expect(authorizeJellyfinQuickConnect).toHaveBeenCalledWith(
      jellyfinConfig,
      "123456",
      "jf-1",
    );
  });

  it("refuses Quick Connect for an unlinked account", async () => {
    currentUser = { ...linkedUser, jellyfinUserId: null };
    const res = await quickConnect("123456");
    expect(res.status).toBe(403);
    expect(authorizeJellyfinQuickConnect).not.toHaveBeenCalled();
  });

  it("answers 404 for a code Jellyfin doesn't know", async () => {
    authorizeJellyfinQuickConnect.mockImplementationOnce(
      async () => "unknown_code",
    );
    const res = await quickConnect("000000");
    expect(res.status).toBe(404);
  });

  it("answers 503 without a Jellyfin integration", async () => {
    getJellyfinConfig.mockImplementationOnce(async () => null);
    const res = await quickConnect("123456");
    expect(res.status).toBe(503);
  });
});
