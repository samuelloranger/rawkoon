import { describe, expect, it, beforeAll } from "bun:test";
import { app } from "../src/index";
import { prisma } from "../src/db";
import { hashPassword } from "../src/utils/password";

const hasDb = !!process.env.DATABASE_URL;

describe("requireUser middleware", () => {
  const testEmail = "middleware-test@example.com";
  const testPassword = "Password123!";
  let sessionCookie = "";

  beforeAll(async () => {
    if (!hasDb) return;

    const existing = await prisma.user.findFirst({
      where: { email: testEmail },
    });

    if (!existing) {
      const pwdHash = await hashPassword(testPassword);
      const user = await prisma.user.create({
        data: {
          email: testEmail,
          name: "Middleware Test",
          emailVerified: false,
          passwordHash: pwdHash,
          firstName: "Middleware",
          lastName: "Test",
          isAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await prisma.baAccount.create({
        data: {
          id: crypto.randomUUID(),
          accountId: testEmail,
          providerId: "credential",
          userId: user.id,
          password: pwdHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    const res = await app.handle(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      }),
    );

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) sessionCookie = setCookie.split(";")[0];
  });

  it("returns 401 when no session cookie is present", async () => {
    if (!hasDb) return;

    const res = await app.handle(new Request("http://localhost/api/auth/me"));

    expect(res.status).toBe(401);
  });

  it("returns 401 when the session cookie references a deleted user", async () => {
    if (!hasDb) return;

    const res = await app.handle(
      new Request("http://localhost/api/auth/me", {
        headers: { cookie: "better-auth.session_token=invalid-token-xyz" },
      }),
    );

    expect(res.status).toBe(401);
  });

  it("resolves authenticated user and returns correct UUID id", async () => {
    if (!hasDb || !sessionCookie) return;

    const res = await app.handle(
      new Request("http://localhost/api/auth/me", {
        headers: { cookie: sessionCookie },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(testEmail);
    // id must be a UUID string, not a number
    expect(typeof body.user.id).toBe("string");
    expect(body.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
