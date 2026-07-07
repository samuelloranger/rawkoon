import { Elysia, t } from "elysia";
import type { Prisma } from "@prisma/client";
import { notificationChannelsRoutes } from "./channels";
import { normalizeNotificationUrl } from "@rawkoon/shared/utils";
import { auth } from "@rawkoon/api/auth";
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
  serverError,
  serviceUnavailable,
  unauthorized,
} from "@rawkoon/api/errors";
import { logActivity } from "@rawkoon/api/utils/activityLogs";

export const notificationsRoutes = new Elysia({ prefix: "/api/notifications" })
  .use(auth)
  // GET /api/notifications/stream - SSE stream of this user's new notifications.
  // Drives the in-app banner regardless of push-subscription status.
  .get("/stream", ({ user, request, set }) => {
    if (!user) return unauthorized(set, "Unauthorized");
    const userId = user.id;

    const encoder = new TextEncoder();
    const signal = request.signal;

    // All setup happens INSIDE start(controller) — this mirrors the working
    // dashboard SSE (createJsonSseResponse). Capturing the controller in start
    // and enqueuing from outside does not flush the response under Bun/Elysia.
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

    // Headers MUST be set on the Response itself — Elysia ignores `set.headers`
    // when a raw Response is returned. EventSource requires the
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
  .get(
    "/",
    async ({ user, query, set }) => {
      if (!user) {
        return unauthorized(set, "Unauthorized");
      }

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

        return {
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
        };
      } catch (error) {
        console.error("Error getting notifications:", error);
        return serverError(set, "Failed to get notifications");
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        read: t.Optional(t.String()),
      }),
    },
  )
  // GET /api/notifications/unread-count - Get unread count
  .get("/unread-count", async ({ user, set }) => {
    if (!user) {
      return unauthorized(set, "Unauthorized");
    }

    try {
      const count = await prisma.notification.count({
        where: { userId: user.id, read: false },
      });

      return { unread_count: count };
    } catch (error) {
      console.error("Error getting unread count:", error);
      return serverError(set, "Failed to get unread count");
    }
  })
  // GET /api/notifications/unread-ids - Lightweight endpoint for the SW to check read status
  .get("/unread-ids", async ({ user, set }) => {
    if (!user) {
      return unauthorized(set, "Unauthorized");
    }

    try {
      const unread = await prisma.notification.findMany({
        where: { userId: user.id, read: false },
        select: { id: true },
      });

      return { ids: unread.map((n) => n.id) };
    } catch (error) {
      console.error("Error getting unread notification IDs:", error);
      return serverError(set, "Failed to get unread IDs");
    }
  })
  // PUT /api/notifications/:id/read - Mark notification as read
  .put("/:id/read", async ({ user, params, set }) => {
    if (!user) {
      return unauthorized(set, "Unauthorized");
    }

    const notificationId = parseInt(params.id, 10);
    if (isNaN(notificationId)) {
      return badRequest(set, "Invalid notification ID");
    }

    try {
      const notification = await prisma.notification.findFirst({
        where: {
          id: notificationId,
          userId: user.id,
        },
      });

      if (!notification) {
        return notFound(set, "Notification not found");
      }

      if (!notification.read) {
        await prisma.notification.update({
          where: { id: notificationId },
          data: {
            read: true,
            readAt: new Date().toISOString(),
          },
        });
      }

      return { success: true, message: "Notification marked as read" };
    } catch (error) {
      console.error("Error marking notification as read:", error);
      return serverError(set, "Failed to mark notification as read");
    }
  })
  // PUT /api/notifications/read-all - Mark all notifications as read
  .put("/read-all", async ({ user, set }) => {
    if (!user) {
      return unauthorized(set, "Unauthorized");
    }

    try {
      const result = await prisma.notification.updateMany({
        where: { userId: user.id, read: false },
        data: {
          read: true,
          readAt: new Date().toISOString(),
        },
      });

      return {
        success: true,
        message: `Marked ${result.count} notifications as read`,
        count: result.count,
      };
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      return serverError(set, "Failed to mark all notifications as read");
    }
  })
  // DELETE /api/notifications/:id - Delete notification
  .delete("/:id", async ({ user, params, set }) => {
    if (!user) {
      return unauthorized(set, "Unauthorized");
    }

    const notificationId = parseInt(params.id, 10);
    if (isNaN(notificationId)) {
      return badRequest(set, "Invalid notification ID");
    }

    try {
      const notification = await prisma.notification.findFirst({
        where: {
          id: notificationId,
          userId: user.id,
        },
      });

      if (!notification) {
        return notFound(set, "Notification not found");
      }

      await prisma.notification.delete({
        where: { id: notificationId },
      });

      return { success: true, message: "Notification deleted" };
    } catch (error) {
      console.error("Error deleting notification:", error);
      return serverError(set, "Failed to delete notification");
    }
  })
  // GET /api/notifications/devices - Get user's notification devices
  .get("/devices", async ({ user, set }) => {
    if (!user) {
      return unauthorized(set, "Unauthorized");
    }

    try {
      const devices = await prisma.userSubscription.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });

      return {
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
      };
    } catch (error) {
      console.error("Error getting devices:", error);
      return serverError(set, "Failed to get devices");
    }
  })
  // DELETE /api/notifications/devices/:id - Delete notification device
  .delete("/devices/:id", async ({ user, params, set }) => {
    if (!user) {
      return unauthorized(set, "Unauthorized");
    }

    const deviceId = parseInt(params.id, 10);

    try {
      const device = await prisma.userSubscription.findFirst({
        where: {
          id: deviceId,
          userId: user.id,
        },
      });

      if (!device) {
        return notFound(set, "Device not found");
      }

      await prisma.userSubscription.delete({
        where: { id: deviceId },
      });

      return { success: true, message: "Device deleted successfully" };
    } catch (error) {
      console.error("Error deleting device:", error);
      return serverError(set, "Failed to delete device");
    }
  })
  // GET /api/notifications/vapid-public-key - Get VAPID public key for push notifications
  .get("/vapid-public-key", ({ set }) => {
    try {
      const publicKey = getVapidPublicKey();
      return { publicKey };
    } catch (error) {
      console.error("Error getting VAPID public key:", error);
      return serviceUnavailable(
        set,
        "VAPID keys not configured. Please set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.",
      );
    }
  })
  // POST /api/notifications/subscribe - Subscribe to push notifications
  .post(
    "/subscribe",
    async ({ user, body, set }) => {
      if (!user) {
        return unauthorized(set, "Unauthorized");
      }

      const { subscription, device_info } = body;

      if (!subscription || !subscription.endpoint) {
        return badRequest(set, "Subscription data is required");
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
          where: {
            userId: user.id,
            endpoint,
          },
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

          await logActivity({
            type: "notification_push_subscription_saved",
            userId: user.id,
            payload: { action: "updated" },
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
          await logActivity({
            type: "notification_push_subscription_saved",
            userId: user.id,
            payload: { action: "created" },
          });
        }

        if (isNewSubscription) {
          try {
            const fr = user.locale === "fr";
            const pushResult = await sendWebPushNotification(
              subscription as PushSubscription,
              {
                title: fr
                  ? "Notifications activées !"
                  : "Notifications enabled!",
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
                set,
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
            return badRequest(
              set,
              `Failed to verify push subscription: ${reason}`,
            );
          }
        }

        return { success: true, message: "Subscription saved successfully" };
      } catch (error) {
        console.error("Error subscribing to notifications:", error);
        return serverError(set, "Failed to subscribe");
      }
    },
    {
      body: t.Object({
        subscription: t.Object({
          endpoint: t.String(),
          keys: t.Object({
            p256dh: t.String(),
            auth: t.String(),
          }),
        }),
        device_info: t.Optional(
          t.Object({
            deviceName: t.Optional(t.Nullable(t.String())),
            osName: t.Optional(t.Nullable(t.String())),
            osVersion: t.Optional(t.Nullable(t.String())),
            browserName: t.Optional(t.Nullable(t.String())),
            browserVersion: t.Optional(t.Nullable(t.String())),
            platform: t.Optional(t.Nullable(t.String())),
          }),
        ),
      }),
    },
  )
  // POST /api/notifications/unsubscribe - Unsubscribe from push notifications
  .post(
    "/unsubscribe",
    async ({ user, body, set }) => {
      if (!user) {
        return unauthorized(set, "Unauthorized");
      }

      try {
        const subscription = body?.subscription;

        if (subscription && subscription.endpoint) {
          await prisma.userSubscription.deleteMany({
            where: {
              userId: user.id,
              endpoint: subscription.endpoint,
            },
          });
          await logActivity({
            type: "notification_unsubscribed",
            userId: user.id,
            payload: {
              endpoint_prefix: subscription.endpoint.slice(0, 50),
            },
          });
        }

        return { success: true, message: "Unsubscribed successfully" };
      } catch (error) {
        console.error("Error unsubscribing from notifications:", error);
        return serverError(set, "Failed to unsubscribe");
      }
    },
    {
      body: t.Optional(
        t.Object({
          subscription: t.Optional(
            t.Object({
              endpoint: t.String(),
            }),
          ),
        }),
      ),
    },
  )
  // POST /api/notifications/test - Send a test push notification
  .post(
    "/test",
    async ({ user, set }) => {
      if (!user) {
        return unauthorized(set, "Unauthorized");
      }

      if (!user.is_admin) {
        return unauthorized(set, "Unauthorized");
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
          return {
            success: true,
            message: `Test notifications sent to ${totalSent} users`,
          };
        } else {
          return badRequest(
            set,
            "No valid push subscriptions found in the system.",
          );
        }
      } catch (error) {
        console.error("Error sending test notification:", error);
        return serverError(set, "Failed to send test notification");
      }
    },
    {
      body: t.Optional(
        t.Object({
          subscription: t.Optional(
            t.Object({
              endpoint: t.String(),
              keys: t.Object({
                p256dh: t.String(),
                auth: t.String(),
              }),
            }),
          ),
        }),
      ),
    },
  )
  .use(notificationChannelsRoutes);
