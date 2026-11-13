import { prisma } from "@rawkoon/api/db";
import { getOrCreateAppSettings } from "@rawkoon/api/services/settings/appSettings";

/** A library page: "MOVIES", "SHOWS", "COLLECTIONS", or "collection:<Jellyfin id>". */
export const TV_SORT_PAGE = /^[A-Za-z0-9_-]{1,40}(:[A-Za-z0-9_-]{1,64})?$/;

/** A sort as the TV writes it: its name, optionally reversed. */
export const TV_SORT_VALUE = /^[A-Z]{1,20}(:reverse)?$/;

export async function getTvLibrarySorts(): Promise<Record<string, string>> {
  const row = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { tvLibrarySorts: true },
  });
  const sorts = row?.tvLibrarySorts;
  return sorts && typeof sorts === "object" && !Array.isArray(sorts)
    ? (sorts as Record<string, string>)
    : {};
}

/** Sets one page's sort, or clears it with null; a single SQL update, so two TVs saving at once don't drop each other's page. */
export async function setTvLibrarySort(
  page: string,
  sort: string | null,
): Promise<void> {
  await getOrCreateAppSettings();
  if (sort === null) {
    await prisma.$executeRaw`UPDATE "app_settings" SET "tv_library_sorts" = "tv_library_sorts" - ${page}, "updated_at" = now() WHERE "id" = 1`;
  } else {
    await prisma.$executeRaw`UPDATE "app_settings" SET "tv_library_sorts" = "tv_library_sorts" || jsonb_build_object(${page}::text, ${sort}::text), "updated_at" = now() WHERE "id" = 1`;
  }
}
