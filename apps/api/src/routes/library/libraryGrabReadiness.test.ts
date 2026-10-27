import { beforeEach, describe, expect, it, mock } from "bun:test";

import { ensureAdmin } from "@rawkoon/api/middleware/ensureAdmin";

// The guards resolve the session through this one seam; swap the user per test.
let current: { id: string; is_admin: boolean } | null = null;
mock.module("@rawkoon/api/middleware/auth", () => ({
  resolveUser: async () => current,
  ensureAdmin,
}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    mediaSettings: {
      findUnique: async () => null,
      upsert: async () => ({ activeIndexerManager: null }),
    },
    qualityProfile: { findMany: async () => [] },
    integration: { findFirst: async () => null },
  },
}));

const { libraryMediaAdminRoutes } = await import(
  "@rawkoon/api/routes/library/libraryMediaAdmin"
);
const { evaluateGrabReadiness } = await import(
  "@rawkoon/api/services/grab/grabReadiness"
);

const get = () =>
  libraryMediaAdminRoutes.fetch(
    new Request("http://localhost/post-processing/grab-readiness"),
  );

describe("GET /post-processing/grab-readiness guard", () => {
  beforeEach(() => {
    current = { id: "member", is_admin: false };
  });

  it("is 403 for a non-admin", async () => {
    expect((await get()).status).toBe(403);
  });

  it("is 401 when signed out", async () => {
    current = null;
    expect((await get()).status).toBe(401);
  });

  it("passes the guard for an admin", async () => {
    current = { id: "admin", is_admin: true };
    const status = (await get()).status;
    expect(status).not.toBe(401);
    expect(status).not.toBe(403);
  });
});

const indexer = (slug: string, enabled = true) => ({
  id: 1,
  slug,
  name: slug,
  protocol: "torrent",
  enabled,
  privacy: "public",
});

const healthy = {
  indexer: {
    state: "ok" as const,
    manager: "prowlarr",
    indexers: [indexer("1"), indexer("2"), indexer("3", false)],
  },
  client: { state: "ok" as const, clientType: "qbittorrent" },
  rssIndexers: ["1", "2"],
  defaultMovieProfileName: "HD",
  defaultShowProfileName: "HD",
  profilesWithoutMaximum: [],
  searchOnAdd: true,
};

const byId = (input: Parameters<typeof evaluateGrabReadiness>[0]) =>
  Object.fromEntries(evaluateGrabReadiness(input).map((c) => [c.id, c]));

describe("evaluateGrabReadiness", () => {
  it("is all ok when everything is set", () => {
    const checks = evaluateGrabReadiness(healthy);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(byId(healthy).rss_indexers?.params).toMatchObject({
      watched: 2,
      total: 2,
      unwatched: [],
    });
  });

  it("warns and lists the unwatched indexers when RSS watches none", () => {
    const c = byId({ ...healthy, rssIndexers: [] }).rss_indexers;
    expect(c?.status).toBe("warn");
    expect(c?.params).toMatchObject({
      watched: 0,
      total: 2,
      unwatched: ["1", "2"],
    });
  });

  it("ignores watched ids that no longer exist or are disabled", () => {
    const c = byId({ ...healthy, rssIndexers: ["3", "gone"] }).rss_indexers;
    expect(c?.status).toBe("warn");
    expect(c?.params).toMatchObject({ watched: 0 });
  });

  it("errors when the indexer manager is missing or unreachable", () => {
    const missing = byId({ ...healthy, indexer: { state: "not_configured" } });
    expect(missing.indexer_manager?.status).toBe("error");
    expect(missing.rss_indexers).toBeUndefined();

    const down = byId({
      ...healthy,
      indexer: { state: "unreachable", manager: "jackett" },
    });
    expect(down.indexer_manager?.params).toMatchObject({
      reason: "unreachable",
      manager: "jackett",
    });
  });

  it("errors when the download client is missing or unreachable", () => {
    expect(
      byId({ ...healthy, client: { state: "not_configured" } }).download_client
        ?.status,
    ).toBe("error");
    expect(
      byId({
        ...healthy,
        client: { state: "unreachable", clientType: "deluge" },
      }).download_client?.params,
    ).toMatchObject({ reason: "unreachable", client_type: "deluge" });
  });

  it("warns for a missing default profile and for profiles without a maximum", () => {
    const checks = byId({
      ...healthy,
      defaultMovieProfileName: null,
      profilesWithoutMaximum: [{ id: 4, name: "Any" }],
    });
    expect(checks.default_movie_profile?.status).toBe("warn");
    expect(checks.default_show_profile?.status).toBe("ok");
    expect(checks.profiles_without_maximum?.status).toBe("warn");
    expect(checks.profiles_without_maximum?.params).toEqual({
      profiles: [{ id: 4, name: "Any" }],
    });
  });

  it("reports search-on-add as information, never a problem", () => {
    const off = byId({ ...healthy, searchOnAdd: false }).search_on_add;
    expect(off?.status).toBe("ok");
    expect(off?.params).toEqual({ enabled: false });
  });
});
