import { prisma } from "@rawkoon/api/db";

export function listChannels(userId: string) {
  return prisma.notificationChannel.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

export function createChannel(data: {
  userId: string;
  type: string;
  label: string;
  config: object;
}) {
  return prisma.notificationChannel.create({
    data: { ...data, enabled: true },
  });
}

export function findChannel(id: number, userId: string) {
  return prisma.notificationChannel.findFirst({ where: { id, userId } });
}

export async function updateChannel(
  id: number,
  userId: string,
  patch: { label?: string; enabled?: boolean; config?: object },
) {
  const result = await prisma.notificationChannel.updateMany({
    where: { id, userId },
    data: {
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.config !== undefined ? { config: patch.config } : {}),
    },
  });
  if (result.count === 0) return null;
  return prisma.notificationChannel.findUnique({ where: { id } });
}

export async function deleteChannel(id: number, userId: string) {
  const result = await prisma.notificationChannel.deleteMany({
    where: { id, userId },
  });
  return result.count > 0;
}
