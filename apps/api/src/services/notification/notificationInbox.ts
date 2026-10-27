import type { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";

export type ListNotificationsInput = {
  userId: string;
  page: number;
  limit: number;
  read?: string;
};

export async function listNotifications(input: ListNotificationsInput) {
  const where: Prisma.NotificationWhereInput = { userId: input.userId };
  if (input.read === "true") {
    where.read = true;
  } else if (input.read === "false") {
    where.read = false;
  }

  const total = await prisma.notification.count({ where });
  const rows = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: input.limit,
    skip: (input.page - 1) * input.limit,
  });
  return { rows, total };
}

export const countUnread = (userId: string) =>
  prisma.notification.count({ where: { userId, read: false } });

export async function listUnreadIds(userId: string): Promise<number[]> {
  const unread = await prisma.notification.findMany({
    where: { userId, read: false },
    select: { id: true },
  });
  return unread.map((n) => n.id);
}

export async function markNotificationRead(
  userId: string,
  id: number,
): Promise<"not_found" | "ok"> {
  const notification = await prisma.notification.findFirst({
    where: { id, userId },
  });
  if (!notification) return "not_found";

  if (!notification.read) {
    await prisma.notification.update({
      where: { id },
      data: { read: true, readAt: new Date().toISOString() },
    });
  }
  return "ok";
}

export async function markAllNotificationsRead(
  userId: string,
): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true, readAt: new Date().toISOString() },
  });
  return result.count;
}

export async function deleteNotification(
  userId: string,
  id: number,
): Promise<"not_found" | "ok"> {
  const notification = await prisma.notification.findFirst({
    where: { id, userId },
  });
  if (!notification) return "not_found";
  await prisma.notification.delete({ where: { id } });
  return "ok";
}
