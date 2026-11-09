import { describe, expect, it, mock } from "bun:test";

const userFindUnique = mock(async (_args: unknown) => null);

mock.module("@rawkoon/api/db", () => ({
  prisma: { user: { findUnique: userFindUnique } },
}));

const { adminUserRoutes } = await import("./adminUserRoutes");

const reset = (password: string) =>
  adminUserRoutes.fetch(
    new Request("http://localhost/users/u1/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );

describe("admin reset-password", () => {
  it("rejects a password that only meets the length rule", async () => {
    const res = await reset("password");
    expect(res.status).toBe(400);
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});
