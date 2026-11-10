import { afterAll, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = await mkdtemp(join(tmpdir(), "clipsauth-"));
Bun.env.IMAGE_STORAGE_DIR = join(base, "data", "images");
await mkdir(join(base, "data", "clips"), { recursive: true });

// Real requireUser/requireAdmin and resolveUser; only the session source and the DB are stubbed.
const users: Record<string, { id: string; isAdmin: boolean }> = {
  "tv-token": { id: "u1", isAdmin: false },
  "admin-token": { id: "u2", isAdmin: true },
};
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const token = headers.get("authorization")?.replace(/^Bearer /, "");
        const u = token ? users[token] : undefined;
        return u ? { user: { id: u.id } } : null;
      },
    },
  },
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const u = Object.values(users).find((x) => x.id === where.id);
        return u
          ? { id: u.id, email: "x@example.test", isAdmin: u.isAdmin }
          : null;
      },
    },
    clipSettings: {
      upsert: async () => ({ enabled: true, paused: false }),
      findUnique: async () => ({ enabled: true, paused: false }),
    },
    previewClip: { findFirst: async () => null },
  },
}));

const { clipsRoutes } = await import("./index");
afterAll(() => rm(base, { recursive: true, force: true }));

const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

describe("clip endpoints with a bearer token (the TV's auth)", () => {
  it("lets any signed-in user read status and ask for a clip", async () => {
    const status = await clipsRoutes.request("/status", bearer("tv-token"));
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ enabled: true });
    expect(
      (
        await clipsRoutes.request(
          "/file?tmdbId=1&type=movie",
          bearer("tv-token"),
        )
      ).status,
    ).toBe(404);
  });

  it("rejects a missing or unknown token with 401", async () => {
    expect((await clipsRoutes.request("/status")).status).toBe(401);
    expect((await clipsRoutes.request("/status", bearer("nope"))).status).toBe(
      401,
    );
  });

  it("keeps admin routes admin-only", async () => {
    expect(
      (await clipsRoutes.request("/progress", bearer("tv-token"))).status,
    ).toBe(403);
    expect(
      (await clipsRoutes.request("/settings", bearer("admin-token"))).status,
    ).toBe(200);
  });
});
