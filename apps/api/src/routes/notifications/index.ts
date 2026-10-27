import { getBaseUrl } from "@rawkoon/api/config";
import { APP_PATHS } from "@rawkoon/shared/constants";
import { Hono } from "hono";
import { z } from "zod";
import { notificationChannelsRoutes } from "./channels";
import {
  apnsRegisterBody,
  listQuery,
  subscribeBody,
  testBody,
  unsubscribeBody,
} from "./schemas";
import { normalizeNotificationUrl } from "@rawkoon/shared/utils";
import {
  getVapidPublicKey,
  sendWebPushNotification,
  type PushSubscription,
} from "@rawkoon/api/utils/webpush";
import {
  createAndQueueNotification,
  getAllUsers,
} from "@rawkoon/api/workers/notificationService";
import { createNotificationStream } from "@rawkoon/api/services/notification/notificationStream";
import {
  countUnread,
  deleteNotification,
  listNotifications,
  listUnreadIds,
  markAllNotificationsRead,
  markNotificationRead,
} from "@rawkoon/api/services/notification/notificationInbox";
import {
  deleteApnsDevice,
  deleteWebPushDevice,
  listApnsDevices,
  listWebPushDevices,
  registerApnsDevice,
  removeWebPushSubscription,
  saveWebPushSubscription,
  unregisterApnsDevice,
} from "@rawkoon/api/services/notification/pushDevices";
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
import {
  assertSseContractIDs,
  SSE_ROUTE_DECLARATIONS,
} from "@rawkoon/api/contracts/sseContract";
import { logActivity } from "@rawkoon/api/utils/activityLogs";

// Mounted at /api/notifications by the edge.
// Auth is per-route (requireUser) — every route is guarded EXCEPT the public
// GET /vapid-public-key. Guards are route-level so they don't leak across the
// /channels merge.
export const notificationsRoutes = new Hono<Env>()
  // Drives the in-app banner regardless of push-subscription status.
  .get("/stream", requireUser, (c) => {
    const userId = c.get("user").id;

    assertSseContractIDs(SSE_ROUTE_DECLARATIONS.notificationsStream.ids);
    const stream = createNotificationStream(userId, c.req.raw.signal);

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
  .get("/", requireUser, queryV(listQuery), async (c) => {
    const user = c.get("user");
    const query = c.req.valid("query");
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
    const readFilter = query.read;

    try {
      const { rows: notificationsList, total } = await listNotifications({
        userId: user.id,
        page,
        limit,
        read: readFilter,
      });

      return ok({
        notifications: notificationsList.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          type: n.type,
          read: n.read,
          read_at: n.readAt,
          url: normalizeNotificationUrl(n.url, getBaseUrl()),
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
  .get("/unread-count", requireUser, async (c) => {
    try {
      const count = await countUnread(c.get("user").id);

      return ok({ unread_count: count });
    } catch (error) {
      console.error("Error getting unread count:", error);
      return serverError("Failed to get unread count");
    }
  })
  .get("/unread-ids", requireUser, async (c) => {
    try {
      const ids = await listUnreadIds(c.get("user").id);

      return ok({ ids });
    } catch (error) {
      console.error("Error getting unread notification IDs:", error);
      return serverError("Failed to get unread IDs");
    }
  })
  .put("/:id/read", requireUser, async (c) => {
    const notificationId = parseInt(c.req.param("id"), 10);
    if (isNaN(notificationId)) {
      return badRequest("Invalid notification ID");
    }

    try {
      const result = await markNotificationRead(
        c.get("user").id,
        notificationId,
      );
      if (result === "not_found") {
        return notFound("Notification not found");
      }

      return ok({ success: true, message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      return serverError("Failed to mark notification as read");
    }
  })
  .put("/read-all", requireUser, async (c) => {
    try {
      const count = await markAllNotificationsRead(c.get("user").id);

      return ok({
        success: true,
        message: `Marked ${count} notifications as read`,
        count,
      });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      return serverError("Failed to mark all notifications as read");
    }
  })
  .delete("/:id", requireUser, async (c) => {
    const notificationId = parseInt(c.req.param("id"), 10);
    if (isNaN(notificationId)) {
      return badRequest("Invalid notification ID");
    }

    try {
      const result = await deleteNotification(c.get("user").id, notificationId);
      if (result === "not_found") {
        return notFound("Notification not found");
      }

      return ok({ success: true, message: "Notification deleted" });
    } catch (error) {
      console.error("Error deleting notification:", error);
      return serverError("Failed to delete notification");
    }
  })
  .get("/devices", requireUser, async (c) => {
    try {
      const devices = await listWebPushDevices(c.get("user").id);

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
  .delete("/devices/:id", requireUser, async (c) => {
    const deviceId = parseInt(c.req.param("id"), 10);

    try {
      const result = await deleteWebPushDevice(c.get("user").id, deviceId);
      if (result === "not_found") {
        return notFound("Device not found");
      }

      return ok({ success: true, message: "Device deleted successfully" });
    } catch (error) {
      console.error("Error deleting device:", error);
      return serverError("Failed to delete device");
    }
  })
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

      const isNewSubscription = await saveWebPushSubscription(
        user.id,
        subscription,
        {
          deviceName,
          osName,
          osVersion,
          browserName,
          browserVersion,
          platform,
        },
      );

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
              data: { url: APP_PATHS.settingsAlerts },
              tag: "welcome-notification",
            },
          );
          if (!pushResult.success) {
            await removeWebPushSubscription(user.id, endpoint);
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
          await removeWebPushSubscription(user.id, endpoint);
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
        await removeWebPushSubscription(user.id, subscription.endpoint);
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
          APP_PATHS.settingsAlerts,
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
  .post("/apns/register", requireUser, jsonV(apnsRegisterBody), async (c) => {
    const user = c.get("user");
    const { device_token, device_info } = c.req.valid("json");
    if (!device_token) return badRequest("device_token is required");
    try {
      await registerApnsDevice(user.id, {
        deviceToken: device_token,
        deviceName: device_info?.device_name ?? null,
        osVersion: device_info?.os_version ?? null,
        appVersion: device_info?.app_version ?? null,
        bundleId: device_info?.bundle_id ?? null,
      });
      return ok({ success: true });
    } catch {
      return serverError("Failed to register device");
    }
  })
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
        await unregisterApnsDevice(user.id, device_token);
        return ok({ success: true });
      } catch {
        return serverError("Failed to unregister device");
      }
    },
  )
  .get("/apns/devices", requireUser, async (c) => {
    try {
      const devices = await listApnsDevices(c.get("user").id);
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
  .delete("/apns/devices/:id", requireUser, async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return badRequest("Invalid device ID");
    try {
      const result = await deleteApnsDevice(c.get("user").id, id);
      if (result === "not_found") return badRequest("Device not found");
      return ok({ success: true });
    } catch {
      return serverError("Failed to delete device");
    }
  })
  .route("/channels", notificationChannelsRoutes)
  .notFound(() => notFound("Not found"))
  .onError(honoOnError);
