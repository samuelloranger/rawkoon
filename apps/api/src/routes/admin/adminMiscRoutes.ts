import { Elysia, t } from "elysia";
import { UAParser } from "ua-parser-js";
import { prisma } from "@rawkoon/api/db";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { formatIso } from "@rawkoon/api/utils";
import { badRequest, serverError } from "@rawkoon/api/errors";

export const adminMiscRoutes = new Elysia()
  .use(requireAdmin)
  // GET /api/admin/sessions - List all active Better Auth sessions
  .get("/sessions", async ({ set }) => {
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

      return {
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
      };
    } catch (error) {
      console.error("Error listing sessions:", error);
      return serverError(set, "Failed to list sessions");
    }
  })

  // DELETE /api/admin/sessions/:id - Revoke a specific session
  .delete(
    "/sessions/:id",
    async ({ params, set }) => {
      try {
        await prisma.baSession.deleteMany({
          where: { id: params.id },
        });
        return { success: true, message: "Session revoked" };
      } catch (error) {
        console.error("Error revoking session:", error);
        return serverError(set, "Failed to revoke session");
      }
    },
    { params: t.Object({ id: t.String() }) },
  )

  // DELETE /api/admin/sessions/user/:userId - Revoke all sessions for a user
  .delete(
    "/sessions/user/:userId",
    async ({ params, set }) => {
      const userId = params.userId;

      try {
        await prisma.baSession.deleteMany({
          where: { userId },
        });
        return { success: true, message: "All sessions revoked" };
      } catch (error) {
        console.error("Error revoking user sessions:", error);
        return serverError(set, "Failed to revoke sessions");
      }
    },
    { params: t.Object({ userId: t.String() }) },
  )

  // GET /api/admin/web-push - List all web push subscriptions
  .get("/web-push", async ({ set }) => {
    try {
      const subs = await prisma.userSubscription.findMany({
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return {
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
      };
    } catch (error) {
      console.error("Error listing web push subscriptions:", error);
      return serverError(set, "Failed to list web push subscriptions");
    }
  })

  // DELETE /api/admin/web-push/:id - Delete a web push subscription
  .delete(
    "/web-push/:id",
    async ({ params, set }) => {
      const id = parseInt(params.id, 10);
      if (isNaN(id)) return badRequest(set, "Invalid subscription ID");

      try {
        await prisma.userSubscription.delete({ where: { id } });
        return { success: true, message: "Web push subscription deleted" };
      } catch (error) {
        console.error("Error deleting web push subscription:", error);
        return serverError(set, "Failed to delete web push subscription");
      }
    },
    { params: t.Object({ id: t.String() }) },
  )

  // GET /api/admin/export - Export all data
  .get("/export", async ({ set }) => {
    try {
      return {
        exported_at: formatIso(new Date()),
      };
    } catch (error) {
      console.error("Error exporting data:", error);
      return serverError(set, "Failed to export data");
    }
  });
