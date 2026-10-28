/**
 * Notification service for creating and enqueuing push notifications
 */

import { getBaseUrl } from "@rawkoon/api/config";
import { prisma } from "@rawkoon/api/db";
import { nowUtc } from "@rawkoon/api/utils";
import { addJob, QUEUE_NAMES } from "@rawkoon/api/services/queueService";
import { emitUserNotification } from "@rawkoon/api/services/notification/notificationEvents";
import type { NotificationJobData } from "@rawkoon/api/services/jobs/notificationWorker";
import { normalizeNotificationUrl } from "@rawkoon/shared/utils";
import type { NotificationPreferenceKey } from "@rawkoon/shared/types/notificationPreferences";
import {
  getNotificationTarget,
  isNotificationEnabled,
} from "@rawkoon/api/services/notification/notificationPreferences";
import { notificationCopy } from "@rawkoon/api/services/notification/notificationCopy";
import { mergeGroupedMetadata } from "@rawkoon/api/services/notification/groupedNotificationMetadata";
import {
  mergeLifecycleMetadata,
  planLifecycleWrite,
} from "@rawkoon/api/services/notification/notificationLifecycle";

interface NotificationMetadata {
  [key: string]: unknown;
}

export type CreateNotificationOptions = {
  /** Merge into an unread notification of the same type within the window. */
  groupKey?: string;
  /**
   * One notification for one piece of work (a grab): each later stage rewrites
   * the row this key created and moves it back to the top, unread.
   */
  lifecycleKey?: string;
  /** False keeps the notification in the app without sending it to devices. */
  push?: boolean;
  preferenceKey?: NotificationPreferenceKey;
  /** Skip the per-user preference lookup when the caller already checked. */
  skipPreferenceCheck?: boolean;
};

const GROUP_WINDOW_MS = 5 * 60 * 1000;

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
    let enabled = true;
    if (!options?.skipPreferenceCheck) {
      const target = await getNotificationTarget(userId);
      enabled =
        !target ||
        isNotificationEnabled(
          target.notificationPreferences,
          notificationType,
          options?.preferenceKey,
        );
    }

    const lifecycleRow = options?.lifecycleKey
      ? await prisma.notification.findFirst({
          where: {
            userId,
            notificationMetadata: {
              path: ["lifecycle_key"],
              equals: options.lifecycleKey,
            },
          },
          orderBy: { id: "desc" },
        })
      : null;
    const plan = planLifecycleWrite({
      hasRow: lifecycleRow != null,
      enabled,
      push: options?.push ?? true,
    });
    if (plan.action === "skip") return false;

    const normalizedUrl = normalizeNotificationUrl(url, getBaseUrl());
    let meta: NotificationMetadata = metadata ? { ...metadata } : {};
    if (options?.lifecycleKey) {
      meta = mergeLifecycleMetadata(
        (lifecycleRow?.notificationMetadata ?? {}) as Record<string, unknown>,
        { ...meta, lifecycle_key: options.lifecycleKey },
      );
    }
    if (options?.groupKey && !options.lifecycleKey) {
      meta.group_key = options.groupKey;
    }

    const lifecycleUpdate = lifecycleRow
      ? await prisma.notification.update({
          where: { id: lifecycleRow.id },
          data: {
            title,
            body,
            type: notificationType,
            url: normalizedUrl,
            imageUrl: imageUrl ?? lifecycleRow.imageUrl,
            notificationMetadata: JSON.parse(JSON.stringify(meta)),
            read: false,
            readAt: null,
            createdAt: nowUtc(),
          },
        })
      : null;

    const grouped = lifecycleUpdate
      ? null
      : options?.groupKey && !options.lifecycleKey
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
      lifecycleUpdate ??
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

    if (!plan.push) return true;

    await addJob<NotificationJobData>(
      QUEUE_NAMES.EXPRESS,
      // A rewritten row pushes again; a reused job id would be dropped as a duplicate.
      `send-push:${notification.id}:${notification.createdAt.getTime()}`,
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

  const merged = mergeGroupedMetadata(meta, opts.metadata, opts.groupKey);
  const count = merged.group_count;
  const show = typeof merged.show === "string" ? merged.show : "";
  const latestCode =
    typeof merged.latest_code === "string" ? merged.latest_code : "";

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

  return prisma.notification.update({
    where: { id: recent.id },
    data: {
      title: mergedTitle,
      body: mergedBody,
      url: opts.url,
      imageUrl: opts.imageUrl ?? recent.imageUrl,
      notificationMetadata: JSON.parse(JSON.stringify(merged)) as object,
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
