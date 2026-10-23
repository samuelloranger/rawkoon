import { prisma } from "@rawkoon/api/db";
import { copyJellyfinAvatars } from "@rawkoon/api/services/jellyfinSignIn";
import {
  getJellyfinConfig,
  jellyfinSessionWhere,
  listJellyfinUsers,
} from "@rawkoon/api/services/jellyfinUsers";

type SyncResult = { revoked: number; avatarsChecked: number };

/**
 * Ends the Jellyfin-based sessions of linked users whose Jellyfin user is
 * disabled or gone, and gives active linked users without a picture their
 * Jellyfin one. The link and the account stay, so a re-enabled user can sign
 * in again. A failed or empty user list changes nothing.
 */
export async function syncJellyfinUsers(
  copyAvatars: typeof copyJellyfinAvatars = copyJellyfinAvatars,
): Promise<SyncResult> {
  const nothing: SyncResult = { revoked: 0, avatarsChecked: 0 };
  const config = await getJellyfinConfig();
  if (!config) return nothing;

  const linked = await prisma.user.findMany({
    where: { jellyfinUserId: { not: null } },
    select: { id: true, jellyfinUserId: true, avatarUrl: true },
  });
  if (linked.length === 0) return nothing;

  let jellyfinUsers;
  try {
    jellyfinUsers = await listJellyfinUsers(config);
  } catch (error) {
    console.error("[syncJellyfinUsers] could not list Jellyfin users:", error);
    return nothing;
  }
  if (jellyfinUsers.length === 0) {
    console.warn("[syncJellyfinUsers] Jellyfin returned no users; skipping");
    return nothing;
  }

  const active = new Set(
    jellyfinUsers.filter((u) => !u.disabled).map((u) => u.id),
  );
  // Accounts linked by an admin, or before pictures were copied, never got one.
  const missingAvatars = linked.flatMap((u) =>
    u.jellyfinUserId && active.has(u.jellyfinUserId) && !u.avatarUrl
      ? [{ jellyfinUserId: u.jellyfinUserId, rawkoonUserId: u.id }]
      : [],
  );
  if (missingAvatars.length > 0) await copyAvatars(config, missingAvatars);

  const revokedIds = linked
    .filter((u) => u.jellyfinUserId && !active.has(u.jellyfinUserId))
    .map((u) => u.id);
  if (revokedIds.length === 0) {
    return { revoked: 0, avatarsChecked: missingAvatars.length };
  }

  const { count } = await prisma.baSession.deleteMany({
    where: jellyfinSessionWhere(revokedIds),
  });
  return { revoked: count, avatarsChecked: missingAvatars.length };
}
