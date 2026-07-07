import { describe, expect, it, beforeAll } from "bun:test";
import { app } from "../src/index";
import { prisma } from "../src/db";
import { hashPassword } from "../src/utils/password";

const hasDb = !!process.env.DATABASE_URL;

describe("Authentication", () => {
  const testEmail = "test@example.com";
  const testPassword = "Password123!";
  let cookies = "";

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
          name: "Test User",
          emailVerified: false,
          passwordHash: pwdHash,
          firstName: "Test",
          lastName: "User",
          isAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // better-auth requires a ba_accounts credential row to authenticate
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
  });

  it("should login successfully with correct credentials", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.user).toBeDefined();
    expect(json.user.email).toBe(testEmail);

    cookies = response.headers.get("set-cookie") || "";
    expect(cookies).toContain("better-auth.session_token=");
  });

  it("should get current user with valid cookie", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/auth/me", {
        headers: { Cookie: cookies },
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.user).toBeDefined();
    expect(json.user.email).toBe(testEmail);
  });

  it("should fail login with wrong password", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail, password: "WrongPassword" }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
