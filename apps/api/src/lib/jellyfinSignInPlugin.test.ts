import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";

Bun.env.SECRET_KEY = "jellyfin-sign-in-test-secret-key-0123456789";

type Row = Record<string, unknown>;
const integrationFindFirst = mock(
  async (_args: unknown): Promise<Row | null> => null,
);
const userFindUnique = mock(
  async (_args: unknown): Promise<Row | null> => null,
);
const userCreate = mock(async (_args: unknown): Promise<Row> => ({}));
const userUpdate = mock(async (_args: unknown) => ({}));
const userUpdateMany = mock(async (_args: unknown) => ({ count: 0 }));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    integration: { findFirst: integrationFindFirst },
    user: {
      findUnique: userFindUnique,
      create: userCreate,
      update: userUpdate,
      updateMany: userUpdateMany,
    },
  },
}));

const { betterAuth } = await import("better-auth");
const { bearer } = await import("better-auth/plugins");
const { memoryAdapter } = await import("better-auth/adapters/memory");
const { encrypt } = await import("@rawkoon/api/services/crypto");
const { invalidateIntegrationConfigCache } = await import(
  "@rawkoon/api/services/integrationConfigCache"
);
const { jellyfinSignIn } = await import("./jellyfinSignInPlugin");

const auth = betterAuth({
  baseURL: "http://localhost:3000",
  secret: "jellyfin-sign-in-test-secret-key-0123456789",
  database: memoryAdapter({
    user: [],
    session: [],
    account: [],
    verification: [],
  }),
  plugins: [bearer(), jellyfinSignIn()],
});

const integration = (flags: Row = { sign_in_enabled: true }) => ({
  enabled: true,
  config: {
    website_url: "http://jellyfin.test",
    api_key: encrypt("admin-key"),
    ...flags,
  },
});

const linkedUser = {
  id: "user-1",
  name: "Viewer",
  email: "viewer@example.com",
  emailVerified: true,
  image: null,
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const signIn = (body: unknown = { username: "viewer", password: "pw" }) =>
  auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/jellyfin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    }),
  );

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
const jellyfin = (authResponse: () => Response | Promise<Response>) => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    url: string | URL | Request,
  ) =>
    String(url).endsWith("/Users/AuthenticateByName")
      ? authResponse()
      : new Response(null, { status: 204 })) as unknown as typeof fetch);
};
const jfUser = (disabled = false) =>
  new Response(
    JSON.stringify({
      AccessToken: "jf-token",
      User: { Id: "jf-1", Name: "viewer", Policy: { IsDisabled: disabled } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

beforeAll(() => {
  invalidateIntegrationConfigCache();
});
beforeEach(() => {
  invalidateIntegrationConfigCache();
  for (const m of [
    integrationFindFirst,
    userFindUnique,
    userCreate,
    userUpdate,
    userUpdateMany,
  ]) {
    m.mockClear();
  }
  integrationFindFirst.mockImplementation(async () => integration());
  userFindUnique.mockImplementation(async () => null);
});
afterEach(() => fetchSpy?.mockRestore());

describe("POST /sign-in/jellyfin", () => {
  it("answers 404 when Jellyfin sign-in is off", async () => {
    integrationFindFirst.mockImplementation(async () =>
      integration({ sign_in_enabled: false }),
    );
    expect((await signIn()).status).toBe(404);
  });

  it("answers 404 when Jellyfin is not configured", async () => {
    integrationFindFirst.mockImplementation(async () => null);
    expect((await signIn()).status).toBe(404);
  });

  it("rejects a body with an empty password", async () => {
    expect((await signIn({ username: "viewer", password: "" })).status).toBe(
      400,
    );
  });

  it("answers 401 for wrong credentials", async () => {
    jellyfin(() => new Response(null, { status: 401 }));
    expect((await signIn()).status).toBe(401);
  });

  it("answers 502 when Jellyfin is unreachable", async () => {
    jellyfin(() => new Response(null, { status: 500 }));
    expect((await signIn()).status).toBe(502);
  });

  it("answers 502 when the request to Jellyfin fails", async () => {
    jellyfin(() => {
      throw new TypeError("connection refused");
    });
    expect((await signIn()).status).toBe(502);
  });

  it("does not report a local failure as Jellyfin being unreachable", async () => {
    jellyfin(() => jfUser());
    userFindUnique.mockImplementation(async () => {
      throw new Error("database down");
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const res = await signIn();
    errorSpy.mockRestore();
    expect(res.status).toBe(500);
  });

  it("answers 403 for a Jellyfin user nobody linked", async () => {
    jellyfin(() => jfUser());
    expect((await signIn()).status).toBe(403);
  });

  it("answers 403 for a disabled Jellyfin user", async () => {
    userFindUnique.mockImplementation(async () => linkedUser);
    jellyfin(() => jfUser(true));
    expect((await signIn()).status).toBe(403);
  });

  it("opens a session for a linked user and sets the cookie and bearer token", async () => {
    userFindUnique.mockImplementation(async () => linkedUser);
    jellyfin(() => jfUser());
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session_token=");
    expect(res.headers.get("set-auth-token")).toBeTruthy();
    const body = (await res.json()) as { user: { id: string }; token: string };
    expect(body.user.id).toBe("user-1");
    expect(body.token).toBeTruthy();
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastLogin: expect.any(Date) },
    });
  });

  it("creates the account under open sign-in", async () => {
    integrationFindFirst.mockImplementation(async () =>
      integration({ sign_in_enabled: true, open_sign_in: true }),
    );
    userCreate.mockImplementation(async () => ({
      ...linkedUser,
      id: "created",
    }));
    jellyfin(() => jfUser());
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(userCreate).toHaveBeenCalledTimes(1);
  });
});
