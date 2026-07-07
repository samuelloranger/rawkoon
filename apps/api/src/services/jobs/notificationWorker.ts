import type { Job } from "bullmq";
import { prisma } from "@rawkoon/api/db";
import {
  sendWebPushNotification,
  type PushSubscription,
} from "@rawkoon/api/utils/webpush";
import { dispatchToChannel } from "@rawkoon/api/utils/notifications/channelDispatchers";
import { isNightTime } from "@rawkoon/api/utils";
import { getBaseUrl } from "@rawkoon/api/config";

function toAbsoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) return url;
  const base = getBaseUrl().replace(/\/$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${base}${path}`;
}

export interface NotificationJobData {
  notificationId: number;
  userId: string;
  title: string;
  body: string;
  notificationType: string;
  url?: string;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
}

export async function processNotificationJob(job: Job) {
  return processRegularNotificationJob(job as Job<NotificationJobData>);
}

async function processRegularNotificationJob(job: Job<NotificationJobData>) {
  const {
    notificationId,
    userId,
    title,
    body,
    notificationType,
    url,
    imageUrl,
    metadata,
  } = job.data;

  console.log(
    `[NotificationWorker] Processing notification ${notificationId} for user ${userId}`,
  );

  // Send Web Push notifications (browser subscriptions). During quiet hours
  // (23h–6h) the notification is already persisted and delivered in-app via SSE,
  // so we suppress only the OS push to avoid waking users — other channels and
  // the notification center are unaffected.
  const subscriptions = isNightTime()
    ? []
    : await prisma.userSubscription.findMany({
        where: { userId },
        // Cap fan-out: stale endpoints only self-heal on a 410, so a user with
        // many dead subscriptions shouldn't balloon every job's outbound sends.
        take: 50,
      });
  for (const sub of subscriptions) {
    try {
      let subscriptionInfo: PushSubscription;
      try {
        subscriptionInfo = JSON.parse(sub.subscriptionInfo) as PushSubscription;
      } catch {
        console.error(
          `Invalid subscription JSON for subscription ${sub.id}, skipping`,
        );
        continue;
      }

      const result = await sendWebPushNotification(subscriptionInfo, {
        title,
        body,
        tag: notificationType,
        image: imageUrl,
        data: {
          url,
          notification_type: notificationType,
          notification_id: notificationId,
          ...metadata,
        },
      });

      if (result.expired) {
        await prisma.userSubscription.delete({ where: { id: sub.id } });
        console.log(
          `Deleted expired subscription ${sub.id} for user ${userId}`,
        );
      }
    } catch (error) {
      console.error(`Error sending push to subscription ${sub.id}:`, error);
    }
  }

  // Dispatch to user-configured channels (provider-agnostic — routed by
  // dispatchToChannel, which parses `config` at the boundary)
  const channels = await prisma.notificationChannel.findMany({
    where: { userId, enabled: true },
    select: { id: true, type: true, label: true, config: true },
    take: 20,
  });
  const absoluteUrl = toAbsoluteUrl(url);
  for (const channel of channels) {
    try {
      await dispatchToChannel(channel, {
        title,
        body,
        url: absoluteUrl,
        imageUrl,
      });
    } catch (err) {
      console.error(
        `[NotificationWorker] Channel ${channel.id} (${channel.type}) failed:`,
        err,
      );
    }
  }

  return { success: true };
}
