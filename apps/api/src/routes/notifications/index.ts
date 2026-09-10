import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { notificationChannelsRoutes } from "./channels";
import { normalizeNotificationUrl } from "@rawkoon/shared/utils";
import { prisma } from "@rawkoon/api/db";
import {
  getVapidPublicKey,
  sendWebPushNotification,
  type PushSubscription,
} from "@rawkoon/api/utils/webpush";
import {
  createAndQueueNotification,
  getAllUsers,
} from "@rawkoon/api/workers/notificationService";
import {
  notificationEventBus,
  type NotificationStreamEvent,
} from "@rawkoon/api/services/notificationEvents";
import {
  badRequest,
  notFound,
  ok,
  serverError,
  serviceUnavailable,
  unauthorized,
} from "@rawkoon/api/errors";
import { type Env, honoOnError } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import { logActivity } from "@rawkoon/api/utils/activityLogs";

const listQuery = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  read: z.string().optional(),
});

// Optional bodies validated by safeParse in the handlers (a missing body is a
// no-op; a present-but-malformed one is a 400) — matches the original schemas.
const unsubscribeBody = z
  .object({ subscription: z.object({ endpoint: z.string() }).optional() })
  .optional();

const testBody = z
  .object({
    subscription: z
      .object({
        endpoint: z.string(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      })
      .optional(),
  })
  .optional();

const subscribeBody = z.object({
  subscription: z.object({
    endpoint: z.string(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
  device_info: z
    .object({
      deviceName: z.string().nullable().optional(),
      osName: z.string().nullable().optional(),
      osVersion: z.string().nullable().optional(),
      browserName: z.string().nullable().optional(),
      browserVersion: z.string().nullable().optional(),
      platform: z.string().nullable().optional(),
    })
    .optional(),
});

const apnsRegisterBody = z.object({
  device_token: z.string(),
  device_info: z
    .object({
      device_name: z.string().optional(),
      os_version: z.string().optional(),
      app_version: z.string().optional(),
      bundle_id: z.string().optional(),
    })
    .optional(),
});

// Mounted at /api/notifications by the edge.
// Auth is per-route (requireUser) — every route is guarded EXCEPT the public
// GET /vapid-public-key. Guards are route-level so they don't leak across the
// /channels merge.
export const notificationsRoutes = new Hono<Env>()
  // GET /api/notifications/stream - SSE stream of this user's new notifications.
  // Drives the in-app banner regardless of push-subscription status.
  .get("/stream", requireUser, (c) => {
    const userId = c.get("user").id;

    const encoder = new TextEncoder();
    const signal = c.req.raw.signal;

    // All setup happens INSIDE start(controller) — this mirrors the working
    // dashboard SSE (createJsonSseResponse). Capturing the controller in start
    // and enqueuing from outside does not flush the response under Bun.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | null = null;

        const writeChunk = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closeStream();
          }
        };

        const onNotification = (event: NotificationStreamEvent) => {
          if (event.userId !== userId) return;
          writeChunk(`data: ${JSON.stringify(event)}\n\n`);
        };

        const closeStream = () => {
          if (closed) return;
          closed = true;
          notificationEventBus.off("notification", onNotification);
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // already closed by the runtime
          }
        };

        notificationEventBus.on("notification", onNotification);
        heartbeat = setInterval(() => writeChunk(": ping\n\n"), 15_000);
        signal.addEventListener("abort", closeStream);

        writeChunk("retry: 3000\n\n");
        // Handshake so the client knows the stream is live.
        writeChunk(`data: ${JSON.stringify({ connected: true })}\n\n`);
      },
      cancel() {
        // Cleanup is driven by the request abort signal above.
      },
    });

    // Headers go on the Response directly. EventSource requires the
    // `text/event-stream` content type, and Caddy only disables buffering for it.
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  })
  // GET /api/notifications - Get notifications with pagination
  .get("/", requireUser, queryV(listQuery), async (c) => {
    const user = c.get("user");
    const query = c.req.valid("query");
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
    const readFilter = query.read;

    try {
      const where: Prisma.NotificationWhereInput = { userId: user.id };

      if (readFilter === "true") {
        where.read = true;
      } else if (readFilter === "false") {
        where.read = false;
      }

      const total = await prisma.notification.count({ where });

      const notificationsList = await prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      });

      return ok({
        notifications: notificationsList.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          type: n.type,
          read: n.read,
          read_at: n.readAt,
          url: normalizeNotificationUrl(n.url),
          image_url: n.imageUrl,
          metadata: n.notificationMetadata,
          created_at: n.createdAt,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Error getting notifications:", error);
      return serverError("Failed to get notifications");
    }
  })
  // GET /api/notifications/unread-count - Get unread count
  .get("/unread-count", requireUser, async (c) => {
    try {
      const count = await prisma.notification.count({
        where: { userId: c.get("user").id, read: false },
      });

      return ok({ unread_count: count });
    } catch (error) {
      console.error("Error getting unread count:", error);
      return serverError("Failed to get unread count");
    }
  })
  // GET /api/notifications/unread-ids - Lightweight endpoint for the SW to check read status
  .get("/unread-ids", requireUser, async (c) => {
    try {
      const unread = await prisma.notification.findMany({
        where: { userId: c.get("user").id, read: false },
        select: { id: true },
      });

      return ok({ ids: unread.map((n) => n.id) });
    } catch (error) {
      console.error("Error getting unread notification IDs:", error);
      return serverError("Failed to get unread IDs");
    }
  })
  // PUT /api/notifications/:id/read - Mark notification as read
  .put("/:id/read", requireUser, async (c) => {
    const notificationId = parseInt(c.req.param("id"), 10);
    if (isNaN(notificationId)) {
      return badRequest("Invalid notification ID");
    }

    try {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId: c.get("user").id },
      });

      if (!notification) {
        return notFound("Notification not found");
      }

      if (!notification.read) {
        await prisma.notification.update({
          where: { id: notificationId },
          data: { read: true, readAt: new Date().toISOString() },
        });
      }

      return ok({ success: true, message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      return serverError("Failed to mark notification as read");
    }
  })
  // PUT /api/notifications/read-all - Mark all notifications as read
  .put("/read-all", requireUser, async (c) => {
    try {
      const result = await prisma.notification.updateMany({
        where: { userId: c.get("user").id, read: false },
        data: { read: true, readAt: new Date().toISOString() },
      });

      return ok({
        success: true,
        message: `Marked ${result.count} notifications as read`,
        count: result.count,
      });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      return serverError("Failed to mark all notifications as read");
    }
  })
  // DELETE /api/notifications/:id - Delete notification
  .delete("/:id", requireUser, async (c) => {
    const notificationId = parseInt(c.req.param("id"), 10);
    if (isNaN(notificationId)) {
      return badRequest("Invalid notification ID");
    }

    try {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId: c.get("user").id },
      });

      if (!notification) {
        return notFound("Notification not found");
      }

      await prisma.notification.delete({ where: { id: notificationId } });

      return ok({ success: true, message: "Notification deleted" });
    } catch (error) {
      console.error("Error deleting notification:", error);
      return serverError("Failed to delete notification");
    }
  })
  // GET /api/notifications/devices - Get user's notification devices
  .get("/devices", requireUser, async (c) => {
    try {
      const devices = await prisma.userSubscription.findMany({
        where: { userId: c.get("user").id },
        orderBy: { createdAt: "desc" },
      });

      return ok({
        devices: devices.map((d) => ({
          id: d.id,
          endpoint: d.endpoint,
          device_name: d.deviceName,
          os_name: d.osName,
          os_version: d.osVersion,
          browser_name: d.browserName,
          browser_version: d.browserVersion,
          platform: d.platform,
          created_at: d.createdAt,
          updated_at: d.updatedAt,
        })),
      });
    } catch (error) {
      console.error("Error getting devices:", error);
      return serverError("Failed to get devices");
    }
  })
  // DELETE /api/notifications/devices/:id - Delete notification device
  .delete("/devices/:id", requireUser, async (c) => {
    const deviceId = parseInt(c.req.param("id"), 10);

    try {
      const device = await prisma.userSubscription.findFirst({
        where: { id: deviceId, userId: c.get("user").id },
      });

      if (!device) {
        return notFound("Device not found");
      }

      await prisma.userSubscription.delete({ where: { id: deviceId } });

      return ok({ success: true, message: "Device deleted successfully" });
    } catch (error) {
      console.error("Error deleting device:", error);
      return serverError("Failed to delete device");
    }
  })
  // GET /api/notifications/vapid-public-key - Get VAPID public key (public)
  .get("/vapid-public-key", (_c) => {
    try {
      const publicKey = getVapidPublicKey();
      return ok({ publicKey });
    } catch (error) {
      console.error("Error getting VAPID public key:", error);
      return serviceUnavailable(
        "VAPID keys not configured. Please set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.",
      );
    }
  })
  // POST /api/notifications/subscribe - Subscribe to push notifications
  .post("/subscribe", requireUser, jsonV(subscribeBody), async (c) => {
    const user = c.get("user");
    const { subscription, device_info } = c.req.valid("json");

    if (!subscription || !subscription.endpoint) {
      return badRequest("Subscription data is required");
    }

    try {
      const endpoint = subscription.endpoint;
      const deviceName = device_info?.deviceName || null;
      const osName = device_info?.osName || "Unknown";
      const osVersion = device_info?.osVersion || null;
      const browserName = device_info?.browserName || "Unknown";
      const browserVersion = device_info?.browserVersion || null;
      const platform = device_info?.platform || null;

      const existingSubscription = await prisma.userSubscription.findFirst({
        where: { userId: user.id, endpoint },
      });

      const now = new Date().toISOString();
      let isNewSubscription = false;

      if (existingSubscription) {
        await prisma.userSubscription.update({
          where: { id: existingSubscription.id },
          data: {
            subscriptionInfo: JSON.stringify(subscription),
            updatedAt: now,
            deviceName,
            osName,
            osVersion,
            browserName,
            browserVersion,
            platform,
          },
        });
      } else {
        await prisma.userSubscription.create({
          data: {
            userId: user.id,
            subscriptionInfo: JSON.stringify(subscription),
            endpoint,
            deviceName,
            osName,
            osVersion,
            browserName,
            browserVersion,
            platform,
            createdAt: now,
            updatedAt: now,
          },
        });

        isNewSubscription = true;
      }

      if (isNewSubscription) {
        try {
          const fr = user.locale === "fr";
          const pushResult = await sendWebPushNotification(
            subscription as PushSubscription,
            {
              title: fr ? "Notifications activées !" : "Notifications enabled!",
              body: fr
                ? "C'est tout bon — vous recevrez désormais vos notifications Rawkoon."
                : "You're all set — you'll now receive your Rawkoon notifications.",
              data: { url: "/settings?tab=notifications" },
              tag: "welcome-notification",
            },
          );
          if (!pushResult.success) {
            await prisma.userSubscription.deleteMany({
              where: { userId: user.id, endpoint },
            });
            return badRequest(
              `Failed to verify push subscription: ${pushResult.error || "unknown error"}`,
            );
          }
          await logActivity({
            type: "notification_welcome_sent",
            userId: user.id,
          });
        } catch (welcomeError) {
          console.error(
            "Failed to send welcome push notification:",
            welcomeError,
          );
          await prisma.userSubscription.deleteMany({
            where: { userId: user.id, endpoint },
          });
          const reason =
            welcomeError instanceof Error
              ? welcomeError.message
              : "unknown error";
          return badRequest(`Failed to verify push subscription: ${reason}`);
        }
      }

      return ok({ success: true, message: "Subscription saved successfully" });
    } catch (error) {
      console.error("Error subscribing to notifications:", error);
      return serverError("Failed to subscribe");
    }
  })
  // POST /api/notifications/unsubscribe - Unsubscribe from push notifications
  .post("/unsubscribe", requireUser, async (c) => {
    const user = c.get("user");
    // The body is optional (missing/empty = no-op success), but a present body
    // must match the shape — a malformed one is a 400, matching the original.
    const parsed = unsubscribeBody.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid request");
    }
    try {
      const subscription = parsed.data?.subscription;

      if (subscription && subscription.endpoint) {
        await prisma.userSubscription.deleteMany({
          where: { userId: user.id, endpoint: subscription.endpoint },
        });
        await logActivity({
          type: "notification_unsubscribed",
          userId: user.id,
          payload: { endpoint_prefix: subscription.endpoint.slice(0, 50) },
        });
      }

      return ok({ success: true, message: "Unsubscribed successfully" });
    } catch (error) {
      console.error("Error unsubscribing from notifications:", error);
      return serverError("Failed to unsubscribe");
    }
  })
  // POST /api/notifications/test - Send a test push notification (admin only)
  .post("/test", requireUser, async (c) => {
    // The optional body is validated first (a malformed one is a 400), matching
    // the original where validation ran before the handler.
    const parsed = testBody.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid request");
    }
    // Admin-only, but returns 401 (not 403) to match the original behavior.
    if (!c.get("user").is_admin) {
      return unauthorized("Unauthorized");
    }

    try {
      const users = await getAllUsers();
      let totalSent = 0;

      for (const targetUser of users) {
        const fr = targetUser.locale === "fr";
        const success = await createAndQueueNotification(
          targetUser.id,
          fr ? "Notification de test" : "Test notification",
          fr
            ? "Si vous voyez ceci, les notifications fonctionnent ! 🎉"
            : "If you see this, notifications are working! 🎉",
          "test",
          "/settings?tab=notifications",
        );
        if (success) {
          totalSent++;
        }
      }

      if (totalSent > 0) {
        return ok({
          success: true,
          message: `Test notifications sent to ${totalSent} users`,
        });
      } else {
        return badRequest("No valid push subscriptions found in the system.");
      }
    } catch (error) {
      console.error("Error sending test notification:", error);
      return serverError("Failed to send test notification");
    }
  })
  // POST /api/notifications/apns/register - register a native iOS device token
  .post("/apns/register", requireUser, jsonV(apnsRegisterBody), async (c) => {
    const user = c.get("user");
    const { device_token, device_info } = c.req.valid("json");
    if (!device_token) return badRequest("device_token is required");
    try {
      const data = {
        userId: user.id,
        deviceToken: device_token,
        deviceName: device_info?.device_name ?? null,
        osVersion: device_info?.os_version ?? null,
        appVersion: device_info?.app_version ?? null,
        bundleId: device_info?.bundle_id ?? null,
        updatedAt: new Date(),
      };
      // An APNs token identifies an app installation, not an account, so it
      // must belong to exactly one user. Without the delete, signing out and
      // signing in as someone else leaves the previous user's row in place
      // and their notifications keep arriving on a device that now belongs to
      // somebody else.
      await prisma.$transaction([
        prisma.apnsDevice.deleteMany({
          where: { deviceToken: device_token, userId: { not: user.id } },
        }),
        prisma.apnsDevice.upsert({
          where: {
            userId_deviceToken: { userId: user.id, deviceToken: device_token },
          },
          update: data,
          create: data,
        }),
      ]);
      return ok({ success: true });
    } catch {
      return serverError("Failed to register device");
    }
  })
  // POST /api/notifications/apns/unregister - drop a token on sign-out
  //
  // By token rather than by row id: the app knows its own token and has no
  // reason to have listed the devices first.
  .post(
    "/apns/unregister",
    requireUser,
    jsonV(z.object({ device_token: z.string() })),
    async (c) => {
      const user = c.get("user");
      const { device_token } = c.req.valid("json");
      if (!device_token) return badRequest("device_token is required");
      try {
        await prisma.apnsDevice.deleteMany({
          where: { userId: user.id, deviceToken: device_token },
        });
        return ok({ success: true });
      } catch {
        return serverError("Failed to unregister device");
      }
    },
  )
  // GET /api/notifications/apns/devices - this user's registered iOS devices
  .get("/apns/devices", requireUser, async (c) => {
    try {
      const devices = await prisma.apnsDevice.findMany({
        where: { userId: c.get("user").id },
        orderBy: { updatedAt: "desc" },
      });
      return ok({
        devices: devices.map((d) => ({
          id: d.id,
          device_name: d.deviceName,
          os_version: d.osVersion,
          app_version: d.appVersion,
          created_at: d.createdAt,
        })),
      });
    } catch {
      return serverError("Failed to load devices");
    }
  })
  // DELETE /api/notifications/apns/devices/:id - remove one iOS device token
  .delete("/apns/devices/:id", requireUser, async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return badRequest("Invalid device ID");
    try {
      const device = await prisma.apnsDevice.findFirst({
        where: { id, userId: c.get("user").id },
      });
      if (!device) return badRequest("Device not found");
      await prisma.apnsDevice.delete({ where: { id } });
      return ok({ success: true });
    } catch {
      return serverError("Failed to delete device");
    }
  })
  .route("/channels", notificationChannelsRoutes)
  .notFound(() => notFound("Not found"))
  .onError(honoOnError);
