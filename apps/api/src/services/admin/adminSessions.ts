import { prisma } from "@rawkoon/api/db";

export function listActiveSessions() {
  return prisma.baSession.findMany({
    where: { expiresAt: { gt: new Date() } },
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeSession(id: string) {
  await prisma.baSession.deleteMany({ where: { id } });
}

export async function revokeUserSessions(userId: string) {
  await prisma.baSession.deleteMany({ where: { userId } });
}

export function listWebPushSubscriptions() {
  return prisma.userSubscription.findMany({
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteWebPushSubscription(id: number) {
  await prisma.userSubscription.delete({ where: { id } });
}
