import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";

Bun.env.SECRET_KEY = "jellyfin-sync-test-secret-key-0123456789abc";

type Row = Record<string, unknown>;
const integrationFindFirst = mock(
  async (_args: unknown): Promise<Row | null> => null,
);
const userFindMany = mock(async (_args: unknown): Promise<Row[]> => []);
const sessionDeleteMany = mock(async (_args: unknown) => ({ count: 2 }));
const copyAvatars = mock(async (_config: unknown, _pairs: unknown) => {});

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    integration: { findFirst: integrationFindFirst },
    user: { findMany: userFindMany },
    baSession: { deleteMany: sessionDeleteMany },
  },
}));

const { encrypt } = await import("@rawkoon/api/services/crypto");
const { invalidateIntegrationConfigCache } = await import(
  "@rawkoon/api/services/integrationConfigCache"
);
const { syncJellyfinUsers } = await import("./syncJellyfinUsers");

const integration = (flags: Row = {}) => ({
  enabled: true,
  config: {
    website_url: "http://jellyfin.test",
    api_key: encrypt("admin-key"),
    ...flags,
  },
});

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
const jellyfinUsers = (res: () => Response) => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () =>
    res()) as unknown as typeof fetch);
};
const usersResponse = (users: Row[]) =>
  new Response(JSON.stringify(users), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const jf = (id: string, disabled = false) => ({
  Id: id,
  Name: id,
  Policy: { IsDisabled: disabled },
});

beforeEach(() => {
  invalidateIntegrationConfigCache();
  for (const m of [
    integrationFindFirst,
    userFindMany,
    sessionDeleteMany,
    copyAvatars,
  ]) {
    m.mockClear();
  }
  integrationFindFirst.mockImplementation(async () => integration());
  userFindMany.mockImplementation(async () => [
    { id: "u-ok", jellyfinUserId: "jf-ok" },
    { id: "u-off", jellyfinUserId: "jf-off" },
    { id: "u-gone", jellyfinUserId: "jf-gone" },
  ]);
});
afterEach(() => fetchSpy?.mockRestore());

describe("syncJellyfinUsers", () => {
  it("revokes only Jellyfin-based sessions of disabled or missing users", async () => {
    jellyfinUsers(() => usersResponse([jf("jf-ok"), jf("jf-off", true)]));
    const result = await syncJellyfinUsers(copyAvatars);
    expect(result.revoked).toBe(2);
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ["u-off", "u-gone"] },
        OR: [
          { providerId: "jellyfin" },
          { userAgent: { startsWith: "Jellyfin: " } },
        ],
      },
    });
  });

  it("still runs when sign-in is off", async () => {
    integrationFindFirst.mockImplementation(async () =>
      integration({ sign_in_enabled: false }),
    );
    jellyfinUsers(() => usersResponse([jf("jf-ok")]));
    await syncJellyfinUsers(copyAvatars);
    expect(sessionDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the user list cannot be read", async () => {
    jellyfinUsers(() => new Response(null, { status: 500 }));
    expect((await syncJellyfinUsers(copyAvatars)).revoked).toBe(0);
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("does nothing on an empty user list", async () => {
    jellyfinUsers(() => usersResponse([]));
    await syncJellyfinUsers(copyAvatars);
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("does nothing when Jellyfin is not configured", async () => {
    integrationFindFirst.mockImplementation(async () => null);
    await syncJellyfinUsers(copyAvatars);
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("does nothing when no Rawkoon user is linked", async () => {
    userFindMany.mockImplementation(async () => []);
    jellyfinUsers(() => usersResponse([jf("jf-ok")]));
    await syncJellyfinUsers(copyAvatars);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("gives active linked users without a picture their Jellyfin one", async () => {
    userFindMany.mockImplementation(async () => [
      { id: "u-bare", jellyfinUserId: "jf-bare", avatarUrl: null },
      { id: "u-pic", jellyfinUserId: "jf-pic", avatarUrl: "/a.png" },
      { id: "u-off", jellyfinUserId: "jf-off", avatarUrl: null },
    ]);
    jellyfinUsers(() =>
      usersResponse([jf("jf-bare"), jf("jf-pic"), jf("jf-off", true)]),
    );
    const result = await syncJellyfinUsers(copyAvatars);
    expect(result.avatarsChecked).toBe(1);
    expect(copyAvatars).toHaveBeenCalledTimes(1);
    expect(copyAvatars.mock.calls[0]?.[1]).toEqual([
      { jellyfinUserId: "jf-bare", rawkoonUserId: "u-bare" },
    ]);
  });

  it("copies no pictures when the user list cannot be read", async () => {
    jellyfinUsers(() => new Response(null, { status: 500 }));
    await syncJellyfinUsers(copyAvatars);
    expect(copyAvatars).not.toHaveBeenCalled();
  });
});
