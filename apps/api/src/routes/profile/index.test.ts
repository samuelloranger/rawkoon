import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";

Bun.env.SECRET_KEY = "jellyfin-profile-test-secret-key-0123456789ab";

type Row = Record<string, unknown>;
const integrationFindFirst = mock(
  async (_args: unknown): Promise<Row | null> => null,
);
const userFindUnique = mock(
  async (_args: unknown): Promise<Row | null> => null,
);
const userUpdate = mock(async (_args: unknown) => ({}));
const userUpdateMany = mock(async (_args: unknown) => ({ count: 0 }));
const passkeyCount = mock(async (_args: unknown) => 0);
const sessionDeleteMany = mock(async (_args: unknown) => ({ count: 1 }));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    integration: { findFirst: integrationFindFirst },
    user: {
      findUnique: userFindUnique,
      update: userUpdate,
      updateMany: userUpdateMany,
    },
    baPasskey: { count: passkeyCount },
    baSession: { deleteMany: sessionDeleteMany },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));
mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireUser: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { id: "user-1" });
    await next();
  },
  requireAdmin: async (_c: unknown, next: () => Promise<void>) => next(),
  ensureAdmin: () => null,
}));

const { encrypt } = await import("@rawkoon/api/services/crypto");
const { invalidateIntegrationConfigCache } = await import(
  "@rawkoon/api/services/integrationConfigCache"
);
const { profileRoutes } = await import("./index");

const integration = (flags: Row = { sign_in_enabled: true }) => ({
  enabled: true,
  config: {
    website_url: "http://jellyfin.test",
    api_key: encrypt("admin-key"),
    ...flags,
  },
});

const call = (method: string, body?: unknown) =>
  profileRoutes.fetch(
    new Request("http://localhost/jellyfin", {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
const jellyfin = (handlers: {
  auth?: () => Response;
  users?: () => Response;
}) => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    url: string | URL | Request,
  ) => {
    const u = String(url);
    if (u.endsWith("/Users/AuthenticateByName")) return handlers.auth!();
    if (u.endsWith("/Users")) return handlers.users!();
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch);
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const authOk = (disabled = false) =>
  json({
    AccessToken: "t",
    User: { Id: "jf-1", Name: "viewer", Policy: { IsDisabled: disabled } },
  });

beforeEach(() => {
  invalidateIntegrationConfigCache();
  for (const m of [
    integrationFindFirst,
    userFindUnique,
    userUpdate,
    userUpdateMany,
    passkeyCount,
    sessionDeleteMany,
  ]) {
    m.mockClear();
  }
  integrationFindFirst.mockImplementation(async () => integration());
  userFindUnique.mockImplementation(async () => ({
    id: "user-1",
    passwordHash: "hash",
    jellyfinUserId: null,
    avatarUrl: "/mine.png",
  }));
  passkeyCount.mockImplementation(async () => 0);
});
afterEach(() => fetchSpy?.mockRestore());

describe("POST /api/profile/jellyfin", () => {
  it("links the Jellyfin user and revokes Jellyfin-based sessions", async () => {
    jellyfin({ auth: () => authOk() });
    userFindUnique.mockImplementation(async (args) =>
      (args as { where: Row }).where.jellyfinUserId
        ? null
        : { id: "user-1", avatarUrl: "/mine.png" },
    );
    const res = await call("POST", { username: "viewer", password: "pw" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jellyfin_name: "viewer" });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { jellyfinUserId: "jf-1" },
    });
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { providerId: "jellyfin" },
          { userAgent: { startsWith: "Jellyfin: " } },
        ],
      },
    });
  });

  it("answers 409 when the Jellyfin user belongs to another account", async () => {
    jellyfin({ auth: () => authOk() });
    userFindUnique.mockImplementation(async () => ({ id: "someone-else" }));
    const res = await call("POST", { username: "viewer", password: "pw" });
    expect(res.status).toBe(409);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("answers 401 for wrong Jellyfin credentials", async () => {
    jellyfin({ auth: () => new Response(null, { status: 401 }) });
    const res = await call("POST", { username: "viewer", password: "bad" });
    expect(res.status).toBe(401);
  });

  it("answers 502 when Jellyfin is unreachable", async () => {
    jellyfin({ auth: () => new Response(null, { status: 500 }) });
    const res = await call("POST", { username: "viewer", password: "pw" });
    expect(res.status).toBe(502);
  });

  it("answers 404 while Jellyfin sign-in is off", async () => {
    integrationFindFirst.mockImplementation(async () =>
      integration({ sign_in_enabled: false }),
    );
    const res = await call("POST", { username: "viewer", password: "pw" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/profile/jellyfin", () => {
  it("refuses to unlink a user with no other way to sign in", async () => {
    userFindUnique.mockImplementation(async () => ({
      id: "user-1",
      passwordHash: null,
      jellyfinUserId: "jf-1",
    }));
    const res = await call("DELETE");
    expect(res.status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("unlinks a user who has a passkey and revokes their Jellyfin sessions", async () => {
    userFindUnique.mockImplementation(async () => ({
      id: "user-1",
      passwordHash: null,
      jellyfinUserId: "jf-1",
    }));
    passkeyCount.mockImplementation(async () => 1);
    const res = await call("DELETE");
    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { jellyfinUserId: null },
    });
    expect(sessionDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("unlinks a user who has a password", async () => {
    userFindUnique.mockImplementation(async () => ({
      id: "user-1",
      passwordHash: "hash",
      jellyfinUserId: "jf-1",
    }));
    expect((await call("DELETE")).status).toBe(200);
  });
});

describe("GET /api/profile/jellyfin", () => {
  it("returns the Jellyfin name for a linked user", async () => {
    userFindUnique.mockImplementation(async () => ({
      id: "user-1",
      passwordHash: "hash",
      jellyfinUserId: "jf-1",
    }));
    jellyfin({ users: () => json([{ Id: "jf-1", Name: "viewer" }]) });
    const res = await call("GET");
    expect(await res.json()).toEqual({
      linked: true,
      jellyfin_name: "viewer",
      can_unlink: true,
    });
  });

  it("still reports the link when Jellyfin is unreachable", async () => {
    userFindUnique.mockImplementation(async () => ({
      id: "user-1",
      passwordHash: null,
      jellyfinUserId: "jf-1",
    }));
    jellyfin({ users: () => new Response(null, { status: 500 }) });
    const res = await call("GET");
    expect(await res.json()).toEqual({
      linked: true,
      jellyfin_name: null,
      can_unlink: false,
    });
  });

  it("reports an unlinked user", async () => {
    const res = await call("GET");
    expect(await res.json()).toEqual({
      linked: false,
      jellyfin_name: null,
      can_unlink: false,
    });
  });
});
