import { prisma } from "@rawkoon/api/db";
import { hashPassword } from "@rawkoon/api/utils/password";
import { jellyfinSessionWhere } from "@rawkoon/api/services/jellyfin/jellyfinUsers";

export const listUsers = () =>
  prisma.user.findMany({ orderBy: { createdAt: "desc" } });

export const findUserByEmail = (email: string) =>
  prisma.user.findFirst({ where: { email } });

export type NewUserInput = {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  isAdmin?: boolean;
  locale?: string;
};

// A credential account row is required alongside the user for email sign-in.
export async function createUserWithCredential(input: NewUserInput) {
  const passwordHash = await hashPassword(input.password);
  const displayName = [input.firstName, input.lastName]
    .filter(Boolean)
    .join(" ");

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: displayName || input.email,
        email: input.email,
        emailVerified: true,
        passwordHash,
        firstName: input.firstName || null,
        lastName: input.lastName || null,
        isAdmin: input.isAdmin || false,
        locale: input.locale || "en",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await tx.baAccount.create({
      data: {
        id: crypto.randomUUID(),
        accountId: input.email,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return user;
  });
}

export const findUsersLinkedToJellyfin = (jellyfinUserIds: string[]) =>
  prisma.user.findMany({
    where: { jellyfinUserId: { in: jellyfinUserIds } },
    select: { id: true, jellyfinUserId: true },
  });

export async function isJellyfinUserLinked(
  jellyfinUserId: string,
): Promise<boolean> {
  return Boolean(await prisma.user.findUnique({ where: { jellyfinUserId } }));
}

export type SetJellyfinLinkResult =
  | { kind: "not_found" }
  | { kind: "unchanged" }
  | { kind: "conflict" }
  | { kind: "linked"; hadAvatar: boolean };

export async function setJellyfinLink(
  userId: string,
  jellyfinUserId: string | null,
): Promise<SetJellyfinLinkResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { kind: "not_found" };
  if (user.jellyfinUserId === jellyfinUserId) return { kind: "unchanged" };
  if (jellyfinUserId) {
    const owner = await prisma.user.findUnique({ where: { jellyfinUserId } });
    if (owner) return { kind: "conflict" };
  }
  // Sessions minted from the old link must not outlive it.
  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { jellyfinUserId } }),
      prisma.baSession.deleteMany({ where: jellyfinSessionWhere(userId) }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return { kind: "conflict" };
    }
    throw error;
  }
  return { kind: "linked", hadAvatar: Boolean(user.avatarUrl) };
}

export type SetUserRoleResult =
  | { kind: "not_found" }
  | { kind: "last_admin" }
  | { kind: "updated"; user: { id: string; isAdmin: boolean | null } };

export async function setUserRole(
  userId: string,
  isAdmin: boolean,
): Promise<SetUserRoleResult> {
  const userToUpdate = await prisma.user.findFirst({ where: { id: userId } });
  if (!userToUpdate) return { kind: "not_found" };

  if (isAdmin === false && userToUpdate.isAdmin) {
    const adminCount = await prisma.user.count({
      where: { isAdmin: true, id: { not: userId } },
    });
    if (adminCount === 0) return { kind: "last_admin" };
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isAdmin },
  });
  return { kind: "updated", user: updated };
}

export async function resetUserPassword(
  userId: string,
  password: string,
): Promise<"not_found" | "ok"> {
  const userToUpdate = await prisma.user.findFirst({ where: { id: userId } });
  if (!userToUpdate) return "not_found";

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.baAccount.updateMany({
      where: { userId, providerId: "credential" },
      data: { password: passwordHash },
    }),
    prisma.baSession.deleteMany({ where: { userId } }),
  ]);
  return "ok";
}

export async function deleteUser(
  userId: string,
): Promise<{ kind: "not_found" } | { kind: "deleted"; email: string }> {
  const userToDelete = await prisma.user.findFirst({ where: { id: userId } });
  if (!userToDelete) return { kind: "not_found" };

  const result = await prisma.user.deleteMany({ where: { id: userId } });
  if (result.count === 0) return { kind: "not_found" };
  return { kind: "deleted", email: userToDelete.email };
}
