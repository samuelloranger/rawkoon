import { describe, expect, it, mock } from "bun:test";

mock.module("@rawkoon/api/db", () => ({
  prisma: { oidcProvider: { findMany: async () => [] } },
}));

const { auth } = await import("./auth");

describe("auth hardening", () => {
  it("never accepts isAdmin from client input", () => {
    const fields = auth.options.user?.additionalFields as Record<
      string,
      { input?: boolean }
    >;
    expect(fields.isAdmin?.input).toBe(false);
  });

  it("does not expose the generic profile and API-key HTTP endpoints", async () => {
    for (const path of ["/update-user", "/api-key/create"]) {
      const res = await auth.handler(
        new Request(`http://localhost/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isAdmin: true }),
        }),
      );
      expect(res.status).toBe(404);
    }
  });
});
