import type { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";
import {
  type NotificationPreferences,
  resolveNotificationPreference,
  type NotificationPreferenceKey,
} from "@rawkoon/shared/types/notificationPreferences";
import { preferenceKeyForNotificationType } from "@rawkoon/api/services/notificationCopy";

export type NotificationTarget = {
  id: string;
  locale: string | null;
  notificationPreferences: NotificationPreferences;
};

function parsePreferences(
  raw: Prisma.JsonValue | null,
): NotificationPreferences {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as NotificationPreferences;
}

export function userNotificationPreferences(
  raw: Prisma.JsonValue | null | undefined,
): NotificationPreferences {
  return parsePreferences(raw ?? null);
}

export async function getAdminNotificationTargets(): Promise<
  NotificationTarget[]
> {
  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true, locale: true, notificationPreferences: true },
  });
  return admins.map((u) => ({
    id: u.id,
    locale: u.locale,
    notificationPreferences: userNotificationPreferences(
      u.notificationPreferences,
    ),
  }));
}

export async function getNotificationTarget(
  userId: string,
): Promise<NotificationTarget | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, locale: true, notificationPreferences: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    locale: user.locale,
    notificationPreferences: userNotificationPreferences(
      user.notificationPreferences,
    ),
  };
}

export function isNotificationEnabled(
  prefs: NotificationPreferences,
  type: string,
  explicitKey?: NotificationPreferenceKey,
): boolean {
  const key = explicitKey ?? preferenceKeyForNotificationType(type);
  if (!key) return true;
  return resolveNotificationPreference(prefs, key);
}

export async function updateUserNotificationPreferences(
  userId: string,
  prefs: NotificationPreferences,
): Promise<NotificationPreferences> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      notificationPreferences: prefs as Prisma.InputJsonValue,
    },
    select: { notificationPreferences: true },
  });
  return userNotificationPreferences(user.notificationPreferences);
}
