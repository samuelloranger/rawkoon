import { prisma } from "@rawkoon/api/db";
import { DEFAULT_TMDB_REGION } from "@rawkoon/api/utils/medias/tmdbRegion";

export function getOrCreateAppSettings() {
  return prisma.appSettings.upsert({
    where: { id: 1 },
    create: { id: 1, countryCode: DEFAULT_TMDB_REGION },
    update: {},
  });
}

export type AppSettingsUpdate = {
  countryCode?: string;
  upcomingWindowMonths?: number;
  upcomingLanguages?: string;
  booksEnabled?: boolean;
};

export function upsertAppSettings(
  countryCode: string | null,
  update: AppSettingsUpdate,
) {
  return prisma.appSettings.upsert({
    where: { id: 1 },
    create: { id: 1, countryCode: countryCode ?? DEFAULT_TMDB_REGION },
    update,
  });
}

export async function getBooksEnabled(): Promise<boolean> {
  const row = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { booksEnabled: true },
  });
  return row?.booksEnabled ?? false;
}
