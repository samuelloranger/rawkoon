import { Hono } from "hono";
import { UAParser } from "ua-parser-js";
import { prisma } from "@rawkoon/api/db";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";

// Mounted under /api/admin; requireAdmin is applied at the admin parent.
export const adminMiscRoutes = new Hono<Env>()
  // GET /api/admin/sessions - List all active Better Auth sessions
  .get("/sessions", async () => {
    try {
      const sessions = await prisma.baSession.findMany({
        where: { expiresAt: { gt: new Date() } },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return ok({
        success: true,
        sessions: sessions.map((session) => {
          const ua = session.userAgent
            ? new UAParser(session.userAgent).getResult()
            : null;
          return {
            id: session.id,
            user_id: session.userId,
            user_email: session.user.email,
            user_name:
              [session.user.firstName, session.user.lastName]
                .filter(Boolean)
                .join(" ") || null,
            expires_at: session.expiresAt.toISOString(),
            created_at: session.createdAt.toISOString(),
            ip_address: session.ipAddress ?? null,
            provider_id: session.providerId ?? null,
            device: ua
              ? { browser: ua.browser.name ?? null, os: ua.os.name ?? null }
              : null,
          };
        }),
      });
    } catch (error) {
      console.error("Error listing sessions:", error);
      return serverError("Failed to list sessions");
    }
  })

  // DELETE /api/admin/sessions/:id - Revoke a specific session
  .delete("/sessions/:id", async (c) => {
    try {
      await prisma.baSession.deleteMany({ where: { id: c.req.param("id") } });
      return ok({ success: true, message: "Session revoked" });
    } catch (error) {
      console.error("Error revoking session:", error);
      return serverError("Failed to revoke session");
    }
  })

  // DELETE /api/admin/sessions/user/:userId - Revoke all sessions for a user
  .delete("/sessions/user/:userId", async (c) => {
    try {
      await prisma.baSession.deleteMany({
        where: { userId: c.req.param("userId") },
      });
      return ok({ success: true, message: "All sessions revoked" });
    } catch (error) {
      console.error("Error revoking user sessions:", error);
      return serverError("Failed to revoke sessions");
    }
  })

  // GET /api/admin/web-push - List all web push subscriptions
  .get("/web-push", async () => {
    try {
      const subs = await prisma.userSubscription.findMany({
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return ok({
        success: true,
        subscriptions: subs.map((s) => ({
          id: s.id,
          user_id: s.userId,
          user_email: s.user.email,
          user_name:
            [s.user.firstName, s.user.lastName].filter(Boolean).join(" ") ||
            null,
          endpoint: s.endpoint ? s.endpoint.slice(0, 40) + "..." : null,
          device_name: s.deviceName,
          os_name: s.osName,
          os_version: s.osVersion,
          browser_name: s.browserName,
          browser_version: s.browserVersion,
          platform: s.platform,
          created_at: s.createdAt?.toISOString() ?? null,
          updated_at: s.updatedAt?.toISOString() ?? null,
        })),
      });
    } catch (error) {
      console.error("Error listing web push subscriptions:", error);
      return serverError("Failed to list web push subscriptions");
    }
  })

  // DELETE /api/admin/web-push/:id - Delete a web push subscription
  .delete("/web-push/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return badRequest("Invalid subscription ID");

    try {
      await prisma.userSubscription.delete({ where: { id } });
      return ok({ success: true, message: "Web push subscription deleted" });
    } catch (error) {
      console.error("Error deleting web push subscription:", error);
      return serverError("Failed to delete web push subscription");
    }
  });
