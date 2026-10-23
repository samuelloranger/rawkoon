import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const config = {
  website_url: "http://jellyfin.test",
  api_key: "admin-key",
  sign_in_enabled: false,
  open_sign_in: false,
};

const getJellyfinConfig = mock(
  async (): Promise<typeof config | null> => config,
);
const createUser = mock(
  async (_args: unknown): Promise<Record<string, unknown>> => ({
    id: "created-1",
    name: "viewer",
    firstName: null,
    email: "jf-1@jellyfin.invalid",
    isAdmin: false,
  }),
);
const resolveJellyfinTokenUser = mock(
  async (): Promise<{
    id: string;
    name: string;
    disabled: boolean;
  } | null> => ({
    id: "jf-1",
    name: "viewer",
    disabled: false,
  }),
);
const findUnique = mock(
  async (): Promise<Record<string, unknown> | null> => ({
    id: "user-1",
    name: "Viewer",
    firstName: null,
    email: "viewer@example.com",
    isAdmin: false,
  }),
);
const createSession = mock(async () => ({ token: "session-token" }));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: { findUnique, create: createUser, findMany: async () => [] },
  },
}));
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: { $context: Promise.resolve({ internalAdapter: { createSession } }) },
}));
mock.module("@rawkoon/api/services/jellyfinUsers", () => ({
  JELLYFIN_SESSION_AGENT_PREFIX: "Jellyfin: ",
  // mock.module is process-wide, so keep every export other suites import.
  jellyfinAuthHeader: (token: string) => ({
    Authorization: `MediaBrowser Token="${token}"`,
  }),
  listJellyfinUsers: async () => [],
  authorizeJellyfinQuickConnect: async () => "ok",
  authenticateJellyfinUser: async () => null,
  JELLYFIN_PROVIDER_ID: "jellyfin",
  jellyfinSessionWhere: () => ({}),
  getJellyfinConfig,
  resolveJellyfinTokenUser,
}));

const { jellyfinSessionRoutes } = await import("./index");

const post = (body: unknown) =>
  jellyfinSessionRoutes.fetch(
    new Request("http://localhost/api/jellyfin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/jellyfin/session", () => {
  beforeEach(() => {
    getJellyfinConfig.mockClear();
    resolveJellyfinTokenUser.mockClear();
    findUnique.mockClear();
    createSession.mockClear();
  });

  it("returns a session token for a linked Jellyfin user", async () => {
    const res = await post({ jellyfin_token: "jf-token", device_name: "TV" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json).toEqual({
      token: "session-token",
      user: { id: "user-1", name: "Viewer", is_admin: false },
    });
    expect(resolveJellyfinTokenUser).toHaveBeenCalledWith(config, "jf-token");
    expect(findUnique).toHaveBeenCalledWith({
      where: { jellyfinUserId: "jf-1" },
    });
    expect(createSession).toHaveBeenCalledWith("user-1", false, {
      userAgent: "Jellyfin: TV",
    });
  });

  it("answers 503 when the Jellyfin integration is not configured", async () => {
    getJellyfinConfig.mockImplementationOnce(async () => null);
    const res = await post({ jellyfin_token: "jf-token" });
    expect(res.status).toBe(503);
    expect(resolveJellyfinTokenUser).not.toHaveBeenCalled();
  });

  it("answers 401 when Jellyfin rejects the token", async () => {
    resolveJellyfinTokenUser.mockImplementationOnce(async () => null);
    const res = await post({ jellyfin_token: "bad" });
    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("answers 403 when no Rawkoon user is linked", async () => {
    findUnique.mockImplementationOnce(async () => null);
    const res = await post({ jellyfin_token: "jf-token" });
    expect(res.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("answers 403 for a linked user who is disabled in Jellyfin", async () => {
    resolveJellyfinTokenUser.mockImplementationOnce(async () => ({
      id: "jf-1",
      name: "viewer",
      disabled: true,
    }));
    const res = await post({ jellyfin_token: "jf-token" });
    expect(res.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
  });

  describe("an unlinked Jellyfin user", () => {
    const withFlags = (flags: Partial<typeof config>) =>
      getJellyfinConfig.mockImplementationOnce(async () => ({
        ...config,
        ...flags,
      }));
    const stubAvatarFetch = () =>
      spyOn(globalThis, "fetch").mockImplementation(
        (async () =>
          new Response(null, { status: 404 })) as unknown as typeof fetch,
      );

    beforeEach(() => {
      createUser.mockClear();
      findUnique.mockImplementationOnce(async () => null);
    });

    it("gets an account when sign-in and open sign-in are both on", async () => {
      const fetchSpy = stubAvatarFetch();
      withFlags({ sign_in_enabled: true, open_sign_in: true });
      const res = await post({ jellyfin_token: "jf-token" });
      fetchSpy.mockRestore();
      expect(res.status).toBe(200);
      expect(createUser).toHaveBeenCalledTimes(1);
      expect(createSession).toHaveBeenCalledWith("created-1", false, {
        userAgent: "Jellyfin: Jellyfin client",
      });
    });

    it("ignores open_sign_in while sign-in is off", async () => {
      withFlags({ sign_in_enabled: false, open_sign_in: true });
      const res = await post({ jellyfin_token: "jf-token" });
      expect(res.status).toBe(403);
      expect(createUser).not.toHaveBeenCalled();
    });
  });

  it("answers 502 when Jellyfin is unreachable", async () => {
    resolveJellyfinTokenUser.mockImplementationOnce(async () => {
      throw new Error("down");
    });
    const res = await post({ jellyfin_token: "jf-token" });
    expect(res.status).toBe(502);
  });

  it("rejects a missing token", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(getJellyfinConfig).not.toHaveBeenCalled();
  });
});
