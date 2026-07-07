/**
 * Notification service for creating and enqueuing push notifications
 */

import { prisma } from "@rawkoon/api/db";
import { nowUtc } from "@rawkoon/api/utils";
import { addJob, QUEUE_NAMES } from "@rawkoon/api/services/queueService";
import { emitUserNotification } from "@rawkoon/api/services/notificationEvents";
import type { NotificationJobData } from "@rawkoon/api/services/jobs/notificationWorker";
import { normalizeNotificationUrl } from "@rawkoon/shared/utils";

interface NotificationMetadata {
  [key: string]: unknown;
}

/**
 * Create a notification record and enqueue a push delivery job
 */
export async function createAndQueueNotification(
  userId: string,
  title: string,
  body: string,
  notificationType: string,
  url?: string,
  metadata?: NotificationMetadata,
  imageUrl?: string,
): Promise<boolean> {
  try {
    const normalizedUrl = normalizeNotificationUrl(url);

    // 1. Create notification record in DB immediately
    // This ensures the user sees it in their notification center in the app
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        body,
        type: notificationType,
        url: normalizedUrl,
        imageUrl,
        notificationMetadata: metadata
          ? JSON.parse(JSON.stringify(metadata))
          : undefined,
        read: false,
        createdAt: nowUtc(),
      },
    });

    console.log(
      `[NotificationService] Created notification ${notification.id} for user ${userId}. Enqueuing push job.`,
    );

    // Relay to the user's open clients over SSE so the in-app banner shows even
    // when the browser has no push subscription. Independent of the push job.
    emitUserNotification({
      userId,
      id: notification.id,
      title,
      body,
      type: notificationType,
      url: normalizedUrl,
      imageUrl,
      metadata,
    });

    // 2. Enqueue the actual push delivery to BullMQ
    await addJob<NotificationJobData>(
      QUEUE_NAMES.EXPRESS,
      `send-push:${notification.id}`,
      {
        notificationId: notification.id,
        userId,
        title,
        body,
        notificationType,
        url: normalizedUrl || undefined,
        imageUrl,
        metadata,
      },
    );

    return true;
  } catch (error) {
    console.error(
      `[NotificationService] Error creating/enqueuing notification for user ${userId}:`,
      error,
    );
    return false;
  }
}

/**
 * Get all users (for sending broadcast notifications)
 */
export async function getAllUsers(): Promise<
  Array<{ id: string; locale: string | null }>
> {
  return prisma.user.findMany({
    select: { id: true, locale: true },
  });
}
