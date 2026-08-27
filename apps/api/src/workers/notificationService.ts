/**
 * Notification service for creating and enqueuing push notifications
 */

import { prisma } from "@rawkoon/api/db";
import { nowUtc } from "@rawkoon/api/utils";
import { addJob, QUEUE_NAMES } from "@rawkoon/api/services/queueService";
import { emitUserNotification } from "@rawkoon/api/services/notificationEvents";
import type { NotificationJobData } from "@rawkoon/api/services/jobs/notificationWorker";
import { normalizeNotificationUrl } from "@rawkoon/shared/utils";
import type { NotificationPreferenceKey } from "@rawkoon/shared/types/notificationPreferences";
import {
  getNotificationTarget,
  isNotificationEnabled,
} from "@rawkoon/api/services/notificationPreferences";
import { notificationCopy } from "@rawkoon/api/services/notificationCopy";

interface NotificationMetadata {
  [key: string]: unknown;
}

export type CreateNotificationOptions = {
  /** Merge into an unread notification of the same type within the window. */
  groupKey?: string;
  preferenceKey?: NotificationPreferenceKey;
  /** Skip the per-user preference lookup when the caller already checked. */
  skipPreferenceCheck?: boolean;
};

const GROUP_WINDOW_MS = 5 * 60 * 1000;

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
  options?: CreateNotificationOptions,
): Promise<boolean> {
  try {
    if (!options?.skipPreferenceCheck) {
      const target = await getNotificationTarget(userId);
      if (
        target &&
        !isNotificationEnabled(
          target.notificationPreferences,
          notificationType,
          options?.preferenceKey,
        )
      ) {
        return false;
      }
    }

    const normalizedUrl = normalizeNotificationUrl(url);
    const meta = metadata ? { ...metadata } : {};
    if (options?.groupKey) {
      meta.group_key = options.groupKey;
    }

    const grouped = options?.groupKey
      ? await tryMergeGroupedNotification({
          userId,
          groupKey: options.groupKey,
          notificationType,
          title,
          body,
          url: normalizedUrl,
          imageUrl,
          metadata: meta,
        })
      : null;

    const notification =
      grouped ??
      (await prisma.notification.create({
        data: {
          userId,
          title,
          body,
          type: notificationType,
          url: normalizedUrl,
          imageUrl,
          notificationMetadata: JSON.parse(JSON.stringify(meta)),
          read: false,
          createdAt: nowUtc(),
        },
      }));

    console.log(
      `[NotificationService] Created notification ${notification.id} for user ${userId}. Enqueuing push job.`,
    );

    emitUserNotification({
      userId,
      id: notification.id,
      title: notification.title,
      body: notification.body,
      type: notificationType,
      url: normalizedUrl,
      imageUrl,
      metadata: notification.notificationMetadata as
        | Record<string, unknown>
        | undefined,
    });

    await addJob<NotificationJobData>(
      QUEUE_NAMES.EXPRESS,
      `send-push:${notification.id}`,
      {
        notificationId: notification.id,
        userId,
        title: notification.title,
        body: notification.body,
        notificationType,
        url: normalizedUrl || undefined,
        imageUrl,
        metadata: notification.notificationMetadata as
          | Record<string, unknown>
          | undefined,
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

async function tryMergeGroupedNotification(opts: {
  userId: string;
  groupKey: string;
  notificationType: string;
  title: string;
  body: string;
  url: string | null;
  imageUrl?: string;
  metadata: NotificationMetadata;
}) {
  const since = new Date(Date.now() - GROUP_WINDOW_MS);
  const recent = await prisma.notification.findFirst({
    where: {
      userId: opts.userId,
      type: opts.notificationType,
      read: false,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!recent?.notificationMetadata) return null;

  const meta = recent.notificationMetadata as Record<string, unknown>;
  if (meta.group_key !== opts.groupKey) return null;

  const count = typeof meta.group_count === "number" ? meta.group_count + 1 : 2;
  const show = typeof opts.metadata.show === "string" ? opts.metadata.show : "";
  const latestCode =
    typeof opts.metadata.latest_code === "string"
      ? opts.metadata.latest_code
      : typeof meta.latest_code === "string"
        ? meta.latest_code
        : "";

  const target = await getNotificationTarget(opts.userId);
  const locale = target?.locale ?? null;

  const mergedTitle =
    count > 1
      ? notificationCopy(locale, "groupedLibraryDownloadedTitle", { count })
      : opts.title;
  const mergedBody =
    count > 1
      ? notificationCopy(locale, "groupedLibraryDownloadedBody", {
          show,
          code: latestCode,
        })
      : opts.body;

  const mergedMeta: Record<string, string | number> = {
    ...(opts.metadata.group_key
      ? { group_key: String(opts.metadata.group_key) }
      : {}),
    group_key: opts.groupKey,
    group_count: count,
    ...(latestCode ? { latest_code: latestCode } : {}),
    ...(show ? { show } : {}),
  };

  return prisma.notification.update({
    where: { id: recent.id },
    data: {
      title: mergedTitle,
      body: mergedBody,
      url: opts.url,
      imageUrl: opts.imageUrl ?? recent.imageUrl,
      notificationMetadata: JSON.parse(JSON.stringify(mergedMeta)) as object,
      createdAt: nowUtc(),
      read: false,
    },
  });
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
