import { describe, expect, it, beforeAll } from "bun:test";
import { app } from "../src/index";
import { prisma } from "../src/db";
import { hashPassword } from "../src/utils/password";

const hasDb = !!process.env.DATABASE_URL;

describe("Dashboard API", () => {
  const testEmail = "stats-test@example.com";
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
          firstName: "Stats",
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

  it("should return stats when authenticated", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/dashboard/stats", {
        headers: { Cookie: cookies },
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.stats).toBeDefined();
    expect(typeof json.stats.habits_streak).toBe("number");
    expect(Array.isArray(json.activities)).toBe(true);
  });

  it("should return 401 when unauthenticated", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/dashboard/stats"),
    );
    expect(response.status).toBe(401);
  });
});
