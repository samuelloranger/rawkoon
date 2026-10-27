import { prisma } from "@rawkoon/api/db";
import { jellyfinSessionWhere } from "@rawkoon/api/services/jellyfin/jellyfinUsers";

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export function findUserByJellyfinId(jellyfinUserId: string) {
  return prisma.user.findUnique({ where: { jellyfinUserId } });
}

export async function canUnlink(userId: string, passwordHash: string | null) {
  if (passwordHash) return true;
  return (await prisma.baPasskey.count({ where: { userId } })) > 0;
}

// Returns "conflict" when another account already holds the Jellyfin id.
export async function linkJellyfinUser(
  userId: string,
  jellyfinUserId: string,
  currentSessionId: string | null,
): Promise<"linked" | "conflict"> {
  try {
    // Sessions minted from a previous link must not outlive it.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { jellyfinUserId },
      }),
      prisma.baSession.deleteMany({
        where: {
          ...jellyfinSessionWhere(userId),
          ...(currentSessionId && { id: { not: currentSessionId } }),
        },
      }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return "conflict";
    throw error;
  }
  return "linked";
}

export async function unlinkJellyfinUser(userId: string) {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { jellyfinUserId: null },
    }),
    prisma.baSession.deleteMany({ where: jellyfinSessionWhere(userId) }),
  ]);
}
