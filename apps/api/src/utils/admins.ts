import { prisma } from "@rawkoon/api/db";

export async function getAdminUserIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true },
  });
  return admins.map((u) => u.id);
}
