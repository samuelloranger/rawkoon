import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { DoctorReport } from "@rawkoon/shared/types";
import type { Env } from "@rawkoon/api/honoEnv";

// Guards resolve the session through this one seam; swap the user per test.
let current: { id: string; is_admin: boolean } | null = null;
mock.module("@rawkoon/api/middleware/auth", () => ({
  resolveUser: async () => current,
}));

const report: DoctorReport = {
  status: "ok",
  version: "1.2.3",
  checked_at: "2026-11-18T00:00:00.000Z",
  checks: [
    {
      id: "version",
      title: "Version",
      status: "ok",
      summary: "Rawkoon 1.2.3.",
      fix: null,
      duration_ms: 1,
    },
  ],
};
const runDoctor = mock(async () => report);

// The route is a thin pass-through; the report's content is tested elsewhere.
mock.module("@rawkoon/api/services/doctor/runDoctor", () => ({ runDoctor }));

const { Hono } = await import("hono");
const { adminDoctorRoutes } = await import("./adminDoctorRoutes");
const { requireAdmin } = await import("@rawkoon/api/middleware/hono/auth");

// Same wiring as the admin parent in index.ts: one requireAdmin over the child.
const app = new Hono<Env>()
  .use("*", requireAdmin)
  .route("/", adminDoctorRoutes);
const get = () => app.fetch(new Request("http://localhost/doctor"));

describe("GET /api/admin/doctor", () => {
  beforeEach(() => {
    current = { id: "member", is_admin: false };
    runDoctor.mockClear();
  });

  it("is 403 for a non-admin", async () => {
    expect((await get()).status).toBe(403);
    expect(runDoctor).not.toHaveBeenCalled();
  });

  it("is 401 when signed out", async () => {
    current = null;
    expect((await get()).status).toBe(401);
    expect(runDoctor).not.toHaveBeenCalled();
  });

  it("returns the report shape for an admin", async () => {
    current = { id: "admin", is_admin: true };
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as DoctorReport;
    expect(body).toEqual(report);
    expect(body.status).toBe("ok");
    expect(body.checks[0]).toMatchObject({
      id: "version",
      duration_ms: expect.any(Number),
    });
    expect(runDoctor).toHaveBeenCalledTimes(1);
  });
});
