import { describe, expect, it, beforeAll } from "bun:test";
import { app } from "../src/index";
import { prisma } from "../src/db";
import { hashPassword } from "../src/utils/password";

const hasDb = !!process.env.DATABASE_URL;

describe("Notifications API", () => {
  const testEmail = "notif-test@example.com";
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
          firstName: "Notif",
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

  it("should return VAPID public key or 503 without auth", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/notifications/vapid-public-key"),
    );
    expect([200, 503]).toContain(response.status);
  });

  it("should return 401 when unauthenticated on GET /", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/notifications"),
    );
    expect(response.status).toBe(401);
  });

  it("should return 401 when unauthenticated on GET /unread-count", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/notifications/unread-count"),
    );
    expect(response.status).toBe(401);
  });

  it("should return 401 when unauthenticated on PUT /read-all", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/notifications/read-all", {
        method: "PUT",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return notifications list when authenticated", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/notifications", {
        headers: { Cookie: cookies },
      }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(Array.isArray(json.notifications)).toBe(true);
    expect(typeof json.total).toBe("number");
  });

  it("should return unread count when authenticated", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/notifications/unread-count", {
        headers: { Cookie: cookies },
      }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(typeof json.count).toBe("number");
  });

  it("should mark all notifications as read", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/notifications/read-all", {
        method: "PUT",
        headers: { Cookie: cookies },
      }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.success).toBe(true);
  });

  it("should return subscribed devices list when authenticated", async () => {
    if (!hasDb) return;
    const response = await app.handle(
      new Request("http://localhost/api/notifications/devices", {
        headers: { Cookie: cookies },
      }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(Array.isArray(json.devices)).toBe(true);
  });
});
