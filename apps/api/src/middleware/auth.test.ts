import { describe, expect, it, mock } from "bun:test";

// getSession resolves nothing: without actAs the guards must see no user, so
// the proof of actAs is the difference between 401 and 200 on the same app.
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => null,
    },
  },
}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        id: "u1",
        email: "u@example.test",
        firstName: "First",
        lastName: "Last",
        isAdmin: true,
        locale: "en",
        lastLogin: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        lastActivity: null,
        avatarUrl: null,
        navPosition: null,
      }),
    },
  },
}));

const { Hono } = await import("hono");
const { factory } = await import("@rawkoon/api/honoEnv");
const { requireAdmin, requireUser } = await import(
  "@rawkoon/api/middleware/hono/auth"
);
const { actAs, getRequestSession, resolveUser } = await import("./auth");

const user = {
  id: "u1",
  email: "u@example.test",
  first_name: "First",
  last_name: "Last",
  is_admin: true,
  locale: "en",
  last_login: null,
  created_at: "2026-01-01T00:00:00.000Z",
  last_activity: null,
  avatar_url: null,
  nav_position: null,
  notification_preferences: null,
  has_passkey: false,
};

const guarded = new Hono()
  .use(
    "*",
    factory.createMiddleware(async (_c, next) => next()),
  )
  .get("/who", requireUser, (c) => c.json({ id: c.get("user").id }))
  .get("/admin", requireAdmin, (c) => c.json({ ok: true }));

describe("actAs", () => {
  it("makes an inner request resolve the seeded user through the guards", async () => {
    const request = new Request("http://localhost/who");
    actAs(request, user);
    const res = await guarded.fetch(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "u1" });
    // The session memo is seeded too, so skip predicates see an authed request.
    expect(await getRequestSession(request)).not.toBeNull();
  });

  it("seeds only that exact Request object — a plain request stays 401", async () => {
    const res = await guarded.fetch(new Request("http://localhost/who"));
    expect(res.status).toBe(401);
    expect(await resolveUser(new Request("http://localhost/x"))).toBeNull();
  });

  it("keeps requireAdmin working (403 for a seeded non-admin)", async () => {
    const member = { ...user, is_admin: false };
    const asAdmin = new Request("http://localhost/admin");
    actAs(asAdmin, user);
    expect((await guarded.fetch(asAdmin)).status).toBe(200);

    const asMember = new Request("http://localhost/admin");
    actAs(asMember, member);
    expect((await guarded.fetch(asMember)).status).toBe(403);
  });
});
