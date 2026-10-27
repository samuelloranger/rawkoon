import { prisma } from "@rawkoon/api/db";

export function listRecentLibraryHealthLogs(limit: number) {
  return prisma.libraryHealthLog.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}
