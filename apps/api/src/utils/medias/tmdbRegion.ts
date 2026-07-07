import { prisma } from "@rawkoon/api/db";

export const DEFAULT_TMDB_REGION = "US";

export function normalizeTmdbRegion(
  value: string | null | undefined,
  fallback = DEFAULT_TMDB_REGION,
): string {
  const region = value?.trim().toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : fallback;
}

export async function getGlobalTmdbRegion(): Promise<string> {
  const settings = await prisma.appSettings.upsert({
    where: { id: 1 },
    create: { id: 1, countryCode: DEFAULT_TMDB_REGION },
    update: {},
    select: { countryCode: true },
  });
  return normalizeTmdbRegion(settings.countryCode);
}
