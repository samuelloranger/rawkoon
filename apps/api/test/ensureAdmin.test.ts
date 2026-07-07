import { describe, it, expect } from "bun:test";
import { ensureAdmin } from "@rawkoon/api/middleware/ensureAdmin";

// Pure-function guard for mutation routes. No DB/auth imports here, so no
// mock.module is needed (and nothing can bleed into other test files).
describe("ensureAdmin", () => {
  it("anon → 401 Unauthorized, no proceed", () => {
    const set: { status?: number | string } = {};
    expect(ensureAdmin(null, set)).toEqual({ error: "Unauthorized" });
    expect(set.status).toBe(401);
  });

  it("non-admin → 403 Forbidden, no proceed", () => {
    const set: { status?: number | string } = {};
    expect(ensureAdmin({ is_admin: false }, set)).toEqual({
      error: "Forbidden",
    });
    expect(set.status).toBe(403);
  });

  it("admin → null (handler proceeds), status untouched", () => {
    const set: { status?: number | string } = {};
    expect(ensureAdmin({ is_admin: true }, set)).toBeNull();
    expect(set.status).toBeUndefined();
  });
});
