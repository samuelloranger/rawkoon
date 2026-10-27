import { prisma } from "@rawkoon/api/db";

export const findRecentActivityLogs = (take: number) =>
  prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { user: { select: { firstName: true, email: true } } },
  });
