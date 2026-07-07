import { describe, expect, it, beforeAll } from "bun:test";
import { app } from "../src/index";
import { prisma } from "../src/db";
import { hashPassword } from "../src/utils/password";

const hasDb = !!process.env.DATABASE_URL;

describe("Users API", () => {
  const testEmail = "users-test@example.com";
  const testPassword = "Password123!";
  let cookies = "";

  beforeAll(async () => {
    if (!hasDb) return;

    const existing = await prisma.user.findFirst({
      where: { email: testEmail },
    });
    if (!existing) {
      const pwdHash = await hashPassword(testPassword);
      await prisma.user.create({
        data: {
          email: testEmail,
          passwordHash: pwdHash,
          firstName: "Users",
          lastName: "Test",
          isAdmin: false,
          createdAt: new Date(),
        },
      });
    }

    const response = await app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      }),
    );
    cookies = response.headers.get("set-cookie") || "";
  });

  it("should return 401 when unauthenticated on GET /me", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/users/me"),
    );
    expect(response.status).toBe(401);
  });

  it("should return current user profile when authenticated", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/users/me", {
        headers: { Cookie: cookies },
      }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.user).toBeDefined();
    expect(json.user.email).toBe(testEmail);
    expect(json.user.first_name).toBe("Users");
  });

  it("should return 401 when unauthenticated on PUT /me", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_name: "Updated" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should update user profile", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookies },
        body: JSON.stringify({ first_name: "UpdatedName" }),
      }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.success).toBe(true);
  });

  it("should return 401 when unauthenticated on POST /me/password", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/users/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: "old", new_password: "new" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should reject password change with wrong current password", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/users/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies },
        body: JSON.stringify({
          current_password: "WrongPassword!",
          new_password: "NewPassword123!",
        }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
