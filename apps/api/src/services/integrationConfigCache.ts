import type { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";

const TTL_MS = 60_000;

type IntegrationConfigRow = {
  enabled: boolean;
  config: Prisma.JsonValue | null;
};

const cache = new Map<
  string,
  { at: number; row: IntegrationConfigRow | null }
>();

/** Drop cached integration row(s). Call after admin updates integration settings if immediate consistency is required. */
export function invalidateIntegrationConfigCache(
  integrationType?: string,
): void {
  if (integrationType) {
    cache.delete(integrationType);
  } else {
    cache.clear();
  }
}

/**
 * Short-lived in-memory cache (60s TTL) for `prisma.integration.findFirst({ where: { type } })`
 * with `{ enabled, config }`. Reduces duplicate DB hits across services and dashboard utils.
 */
export async function getIntegrationConfigRecord(
  integrationType: string,
): Promise<IntegrationConfigRow | null> {
  const now = Date.now();
  const hit = cache.get(integrationType);
  if (hit && now - hit.at < TTL_MS) {
    return hit.row;
  }

  const integration = await prisma.integration.findFirst({
    where: { type: integrationType },
    select: { enabled: true, config: true },
  });

  const row: IntegrationConfigRow | null = integration
    ? { enabled: integration.enabled, config: integration.config ?? null }
    : null;

  cache.set(integrationType, { at: now, row });
  return row;
}
