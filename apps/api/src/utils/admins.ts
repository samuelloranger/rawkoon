import { prisma } from "@rawkoon/api/db";

/**
 * Single source for the admin fan-out list (grab skipped, media downloaded,
 * post-process failed, request created/decided, new GitHub release). Not cached
 * on purpose: `users` is a handful of rows on a self-hosted instance, so the
 * query is far cheaper than the stale-admin-set bugs a process-local cache
 * invites.
 */
export async function getAdminUserIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true },
  });
  return admins.map((u) => u.id);
}
