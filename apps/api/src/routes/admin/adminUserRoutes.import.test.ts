import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";

Bun.env.SECRET_KEY = "jellyfin-import-test-secret-key-0123456789ab";

type Row = Record<string, unknown>;
const integrationFindFirst = mock(
  async (_args: unknown): Promise<Row | null> => null,
);
const userFindUnique = mock(
  async (_args: unknown): Promise<Row | null> => null,
);
const userFindMany = mock(async (_args: unknown): Promise<Row[]> => []);
const userCreate = mock(async (_args: unknown): Promise<Row> => ({}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    integration: { findFirst: integrationFindFirst },
    user: {
      findUnique: userFindUnique,
      findMany: userFindMany,
      create: userCreate,
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    },
    baSession: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  },
}));

const { encrypt } = await import("@rawkoon/api/services/crypto");
const { invalidateIntegrationConfigCache } = await import(
  "@rawkoon/api/services/integrationConfigCache"
);
const { adminUserRoutes } = await import("./adminUserRoutes");

const jf = (id: string, disabled = false) => ({
  Id: id,
  Name: `name-${id}`,
  Policy: { IsDisabled: disabled },
});

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
const jellyfinUsers = (users: Row[]) => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    url: string | URL | Request,
  ) =>
    String(url).endsWith("/Users")
      ? new Response(JSON.stringify(users), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : new Response(null, { status: 404 })) as unknown as typeof fetch);
};

const importUsers = (users: unknown) =>
  adminUserRoutes.fetch(
    new Request("http://localhost/users/import-jellyfin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ users }),
    }),
  );

beforeEach(() => {
  invalidateIntegrationConfigCache();
  for (const m of [
    integrationFindFirst,
    userFindUnique,
    userFindMany,
    userCreate,
  ]) {
    m.mockClear();
  }
  integrationFindFirst.mockImplementation(async () => ({
    enabled: true,
    config: {
      website_url: "http://jellyfin.test",
      api_key: encrypt("admin-key"),
    },
  }));
  userFindUnique.mockImplementation(async () => null);
  userCreate.mockImplementation(async (args) => ({
    id: `user-${(args as { data: Row }).data.jellyfinUserId}`,
  }));
});
afterEach(() => fetchSpy?.mockRestore());

describe("POST /users/import-jellyfin", () => {
  it("creates regular users and skips disabled, unknown and linked ones", async () => {
    // A 404 on the avatar fetch keeps the copy a no-op.
    jellyfinUsers([jf("a"), jf("b", true), jf("c")]);
    userFindUnique.mockImplementation(async (args) =>
      (args as { where: Row }).where.jellyfinUserId === "c"
        ? { id: "existing" }
        : null,
    );
    const res = await importUsers([
      { jellyfin_user_id: "a" },
      { jellyfin_user_id: "b" },
      { jellyfin_user_id: "c" },
      { jellyfin_user_id: "ghost" },
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      created: [{ jellyfin_user_id: "a", user_id: "user-a" }],
      skipped: [
        { jellyfin_user_id: "b", reason: "disabled" },
        { jellyfin_user_id: "c", reason: "already_linked" },
        { jellyfin_user_id: "ghost", reason: "not_found" },
      ],
    });
    expect(userCreate).toHaveBeenCalledTimes(1);
    const data = (userCreate.mock.calls[0]![0] as { data: Row }).data;
    expect(data.isAdmin).toBe(false);
    expect(data.email).toBe("a@jellyfin.invalid");
  });

  it("sets admin only when asked", async () => {
    jellyfinUsers([jf("a"), jf("b")]);
    await importUsers([
      { jellyfin_user_id: "a", is_admin: true },
      { jellyfin_user_id: "b", is_admin: false },
    ]);
    const roles = userCreate.mock.calls.map(
      (c) => (c[0] as { data: Row }).data.isAdmin,
    );
    expect(roles).toEqual([true, false]);
  });

  it("answers before the avatar copies finish", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let avatarCalls = 0;
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
      url: string | URL | Request,
    ) => {
      if (String(url).endsWith("/Users")) {
        return new Response(JSON.stringify([jf("a"), jf("b")]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      avatarCalls++;
      await gate;
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch);
    const res = await importUsers([
      { jellyfin_user_id: "a" },
      { jellyfin_user_id: "b" },
    ]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { created: unknown[] }).created).toHaveLength(
      2,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(avatarCalls).toBe(2);
    release();
  });

  it("answers 503 when Jellyfin is not configured", async () => {
    integrationFindFirst.mockImplementation(async () => null);
    expect((await importUsers([{ jellyfin_user_id: "a" }])).status).toBe(503);
  });
});

describe("GET /jellyfin-users", () => {
  it("includes disabled and linked_user_id", async () => {
    jellyfinUsers([jf("a"), jf("b", true)]);
    userFindMany.mockImplementation(async () => [
      { id: "rk-1", jellyfinUserId: "a" },
    ]);
    const res = await adminUserRoutes.fetch(
      new Request("http://localhost/jellyfin-users"),
    );
    expect(await res.json()).toEqual({
      users: [
        { id: "a", name: "name-a", disabled: false, linked_user_id: "rk-1" },
        { id: "b", name: "name-b", disabled: true, linked_user_id: null },
      ],
    });
  });
});

describe("GET /users", () => {
  it("includes each user's avatar URL", async () => {
    userFindMany.mockImplementation(async () => [
      {
        id: "u1",
        email: "viewer@example.com",
        firstName: "Viewer",
        lastName: null,
        isAdmin: false,
        locale: "en",
        createdAt: null,
        lastLogin: null,
        jellyfinUserId: null,
        avatarUrl: "https://rawkoon.example.com/api/users/avatar/a.png",
      },
    ]);
    const res = await adminUserRoutes.fetch(
      new Request("http://localhost/users"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Row[] };
    expect(body.users[0]?.avatar_url).toBe(
      "https://rawkoon.example.com/api/users/avatar/a.png",
    );
  });
});

describe("PATCH /users/:id/jellyfin", () => {
  const link = (userRow: Row) => {
    userFindUnique.mockImplementation(async (args) =>
      (args as { where: Row }).where.id === "u1" ? userRow : null,
    );
    jellyfinUsers([]);
    return adminUserRoutes.fetch(
      new Request("http://localhost/users/u1/jellyfin", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jellyfin_user_id: "jf-1" }),
      }),
    );
  };
  const askedForPicture = () =>
    (fetchSpy?.mock.calls ?? []).some(([url]) =>
      String(url).endsWith("/Users/jf-1/Images/Primary"),
    );

  it("copies the Jellyfin picture onto a user who has none", async () => {
    const res = await link({ id: "u1", jellyfinUserId: null, avatarUrl: null });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(askedForPicture()).toBe(true);
  });

  it("keeps a picture the user already has", async () => {
    const res = await link({
      id: "u1",
      jellyfinUserId: null,
      avatarUrl: "/api/users/avatar/own.png",
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(askedForPicture()).toBe(false);
  });
});
