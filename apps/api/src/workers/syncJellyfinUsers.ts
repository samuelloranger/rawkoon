import { prisma } from "@rawkoon/api/db";
import {
  getJellyfinConfig,
  jellyfinSessionWhere,
  listJellyfinUsers,
} from "@rawkoon/api/services/jellyfinUsers";

/**
 * Ends the Jellyfin-based sessions of linked users whose Jellyfin user is
 * disabled or gone. The link and the account stay, so a re-enabled user can
 * sign in again. A failed or empty user list changes nothing.
 */
export async function syncJellyfinUsers(): Promise<{ revoked: number }> {
  const config = await getJellyfinConfig();
  if (!config) return { revoked: 0 };

  const linked = await prisma.user.findMany({
    where: { jellyfinUserId: { not: null } },
    select: { id: true, jellyfinUserId: true },
  });
  if (linked.length === 0) return { revoked: 0 };

  let jellyfinUsers;
  try {
    jellyfinUsers = await listJellyfinUsers(config);
  } catch (error) {
    console.error("[syncJellyfinUsers] could not list Jellyfin users:", error);
    return { revoked: 0 };
  }
  if (jellyfinUsers.length === 0) {
    console.warn("[syncJellyfinUsers] Jellyfin returned no users; skipping");
    return { revoked: 0 };
  }

  const active = new Set(
    jellyfinUsers.filter((u) => !u.disabled).map((u) => u.id),
  );
  const revokedIds = linked
    .filter((u) => u.jellyfinUserId && !active.has(u.jellyfinUserId))
    .map((u) => u.id);
  if (revokedIds.length === 0) return { revoked: 0 };

  const { count } = await prisma.baSession.deleteMany({
    where: jellyfinSessionWhere(revokedIds),
  });
  return { revoked: count };
}
