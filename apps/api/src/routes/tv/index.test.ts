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
mock.module("@rawkoon/api/services/jellyfin/jellyfinUsers", () => ({
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
const realSorts = await import("@rawkoon/api/services/tv/tvLibrarySorts");
const getTvLibrarySorts = mock(async () => ({ MOVIES: "YEAR" }));
const setTvLibrarySort = mock(
  async (_page: string, _sort: string | null) => {},
);
mock.module("@rawkoon/api/services/tv/tvLibrarySorts", () => ({
  ...realSorts,
  getTvLibrarySorts,
  setTvLibrarySort,
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

describe("library sorts", () => {
  const put = (body: unknown) =>
    tvRoutes.fetch(
      new Request("http://localhost/library-sorts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  beforeEach(() => setTvLibrarySort.mockClear());

  it("returns the shared sorts", async () => {
    const res = await tvRoutes.fetch(
      new Request("http://localhost/library-sorts"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sorts: { MOVIES: "YEAR" } });
  });

  it("saves a page's sort, a collection's included, and clears one with null", async () => {
    expect(
      (await put({ page: "collection:abc123", sort: "YEAR:reverse" })).status,
    ).toBe(200);
    expect(setTvLibrarySort).toHaveBeenCalledWith(
      "collection:abc123",
      "YEAR:reverse",
    );
    expect((await put({ page: "MOVIES", sort: null })).status).toBe(200);
    expect(setTvLibrarySort).toHaveBeenLastCalledWith("MOVIES", null);
  });

  it("refuses a malformed page or sort", async () => {
    expect((await put({ page: "a b", sort: "YEAR" })).status).toBe(400);
    expect((await put({ page: "MOVIES", sort: "year; drop" })).status).toBe(
      400,
    );
    expect((await put({ page: "MOVIES", sort: "YEAR:sideways" })).status).toBe(
      400,
    );
    expect(setTvLibrarySort).not.toHaveBeenCalled();
  });
});
