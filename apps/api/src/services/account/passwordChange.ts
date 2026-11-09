import { prisma } from "@rawkoon/api/db";
import { hashPassword, verifyPassword } from "@rawkoon/api/utils/password";

export type PasswordChangeResult =
  | { ok: true }
  | { ok: false; reason: "user_not_found" | "no_password" | "incorrect" };

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string,
): Promise<PasswordChangeResult> {
  const dbUser = await prisma.user.findFirst({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!dbUser) return { ok: false, reason: "user_not_found" };
  if (!dbUser.passwordHash) return { ok: false, reason: "no_password" };

  const isCurrentValid = await verifyPassword(
    currentPassword,
    dbUser.passwordHash,
  );
  if (!isCurrentValid) return { ok: false, reason: "incorrect" };

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.baAccount.updateMany({
      where: { userId, providerId: "credential" },
      data: { password: passwordHash },
    }),
    // Keep the session making the change so the user stays signed in on this device.
    prisma.baSession.deleteMany({
      where: {
        userId,
        ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
      },
    }),
  ]);
  return { ok: true };
}
