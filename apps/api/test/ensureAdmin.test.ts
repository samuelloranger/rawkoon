import { describe, it, expect } from "bun:test";
import { ensureAdmin } from "@rawkoon/api/middleware/ensureAdmin";

// Pure-function guard for mutation routes. No DB/auth imports here, so no
// mock.module is needed (and nothing can bleed into other test files).
describe("ensureAdmin", () => {
  it("anon → 401 Unauthorized Response, no proceed", async () => {
    const res = ensureAdmin(null) as Response;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("non-admin → 403 Forbidden Response, no proceed", async () => {
    const res = ensureAdmin({ is_admin: false }) as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("admin → null (handler proceeds)", () => {
    expect(ensureAdmin({ is_admin: true })).toBeNull();
  });
});
