import type { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";
import { nowUtc } from "@rawkoon/api/utils";

export function findIntegrationRow(
  type: string,
  options: { enabledOnly?: boolean } = {},
) {
  return prisma.integration.findFirst({
    where: { type, ...(options.enabledOnly ? { enabled: true } : {}) },
  });
}

export function upsertIntegrationRow(input: {
  type: string;
  enabled: boolean;
  config: Prisma.InputJsonValue;
}) {
  const now = nowUtc();
  const { type, enabled, config } = input;
  return prisma.integration.upsert({
    where: { type },
    update: { enabled, config, updatedAt: now },
    create: { type, enabled, config, createdAt: now, updatedAt: now },
  });
}
