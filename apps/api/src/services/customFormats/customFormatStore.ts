import type { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";

export const listCustomFormats = () =>
  prisma.customFormat.findMany({ orderBy: { name: "asc" } });

export const createCustomFormat = (
  name: string,
  conditions: Prisma.InputJsonValue,
) => prisma.customFormat.create({ data: { name, conditions } });

export type UpdateCustomFormatResult =
  | { status: "not_found" }
  | { status: "updated"; row: Awaited<ReturnType<typeof createCustomFormat>> };

export async function updateCustomFormat(
  id: number,
  name: string,
  conditions: Prisma.InputJsonValue,
): Promise<UpdateCustomFormatResult> {
  const existing = await prisma.customFormat.findUnique({ where: { id } });
  if (!existing) return { status: "not_found" };
  const row = await prisma.customFormat.update({
    where: { id },
    data: { name, conditions },
  });
  return { status: "updated", row };
}

export type DeleteCustomFormatResult =
  | { status: "not_found" }
  | { status: "in_use" }
  | { status: "deleted" };

export async function deleteCustomFormat(
  id: number,
): Promise<DeleteCustomFormatResult> {
  const existing = await prisma.customFormat.findUnique({ where: { id } });
  if (!existing) return { status: "not_found" };
  const inUse = await prisma.qualityProfileCustomFormat.count({
    where: { customFormatId: id },
  });
  if (inUse > 0) return { status: "in_use" };
  await prisma.customFormat.delete({ where: { id } });
  return { status: "deleted" };
}
