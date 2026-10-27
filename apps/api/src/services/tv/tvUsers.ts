import { prisma } from "@rawkoon/api/db";

export const findTvUser = (id: string) =>
  prisma.user.findUnique({ where: { id } });
