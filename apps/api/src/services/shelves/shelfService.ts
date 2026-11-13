import type {
  ShelfCoverStyle,
  ShelfDetail,
  ShelfEntryView,
  ShelfMediaType,
  ShelfMembership,
  ShelfOrderMode,
  ShelfSeedSummary,
  ShelfSummary,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import {
  libraryArtwork,
  loadLibraryRefs,
  loadLibrarySeasons,
  mapShelfDetail,
  mapShelfEntries,
  mapShelfSummary,
  orderModeOf,
  type ShelfEntryRow,
  type ShelfRow,
} from "./shelfMapping";
import {
  fetchShelfBackdropUrl,
  fetchShelfTitle,
  fetchShelfTmdbKey,
} from "./shelfTmdb";
import { findSeed, listSeeds, type SeedLanguage } from "./seeds";
import { entryRowSelect, key, shelfRowSelect } from "./shelfRows";
import { isVisibleNow } from "./shelfVisibility";

const BACKDROP_TTL = 24 * 60 * 60;

export type CreateShelfInput = {
  name?: string;
  description?: string | null;
  seed?: string;
  orderMode?: ShelfOrderMode;
  coverStyle?: ShelfCoverStyle;
  coverTmdbId?: number | null;
  coverType?: ShelfMediaType | null;
  homeRow?: boolean;
  visibleFrom?: string | null;
  visibleTo?: string | null;
};

export type ShelfPatch = Partial<{
  name: string;
  description: string | null;
  orderMode: ShelfOrderMode;
  coverStyle: ShelfCoverStyle;
  coverTmdbId: number | null;
  coverType: ShelfMediaType | null;
  homeRow: boolean;
  visibleFrom: string | null;
  visibleTo: string | null;
}>;

/** The chosen cover title's backdrop: a library override first, else TMDB (cached a day). */
async function coverBackdropUrl(shelf: ShelfRow): Promise<string | null> {
  if (shelf.coverStyle !== "backdrop" || !shelf.coverTmdbId) return null;
  const type: ShelfMediaType = shelf.coverType === "show" ? "show" : "movie";
  const refs = await loadLibraryRefs([{ tmdbId: shelf.coverTmdbId, type }]);
  const ref = refs.get(key(type, shelf.coverTmdbId));
  if (ref) {
    const art = libraryArtwork(ref);
    if (art.backdropUrl) return art.backdropUrl;
  }
  const cacheKey = `shelves:backdrop:${type}:${shelf.coverTmdbId}`;
  const cached = await getJsonCache<{ url: string | null }>(cacheKey);
  if (cached) return cached.url;
  const apiKey = await fetchShelfTmdbKey();
  const url = apiKey
    ? await fetchShelfBackdropUrl(apiKey, shelf.coverTmdbId, type)
    : null;
  await setJsonCache(cacheKey, { url }, BACKDROP_TTL);
  return url;
}

async function summariesOf(
  shelves: ShelfRow[],
  isAdmin: boolean,
  now = new Date(),
): Promise<ShelfSummary[]> {
  if (!shelves.length) return [];
  const entries = (await prisma.shelfEntry.findMany({
    where: { shelfId: { in: shelves.map((s) => s.id) } },
    select: entryRowSelect,
  })) as ShelfEntryRow[];
  const refs = await loadLibraryRefs(entries);
  const seasons = await loadLibrarySeasons(entries);
  const byShelf = new Map<number, ShelfEntryRow[]>();
  for (const entry of entries) {
    const list = byShelf.get(entry.shelfId) ?? [];
    list.push(entry);
    byShelf.set(entry.shelfId, list);
  }
  const out: ShelfSummary[] = [];
  for (const shelf of shelves) {
    const views = mapShelfEntries(
      byShelf.get(shelf.id) ?? [],
      refs,
      orderModeOf(shelf.orderMode),
      isAdmin,
      seasons,
    );
    out.push(
      mapShelfSummary({
        shelf,
        entries: views,
        backdropUrl: await coverBackdropUrl(shelf),
        now,
      }),
    );
  }
  return out;
}

export async function listShelves(
  isAdmin: boolean,
  includeOutsideWindow: boolean,
): Promise<ShelfSummary[]> {
  const shelves = (await prisma.shelf.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: shelfRowSelect,
  })) as ShelfRow[];
  const summaries = await summariesOf(shelves, isAdmin);
  return includeOutsideWindow
    ? summaries
    : summaries.filter((shelf) => shelf.visible_now);
}

export async function getShelfDetail(
  id: number,
  isAdmin: boolean,
): Promise<ShelfDetail | null> {
  const shelf = (await prisma.shelf.findUnique({
    where: { id },
    select: shelfRowSelect,
  })) as ShelfRow | null;
  if (!shelf) return null;
  // A shelf outside its window is for admins only, as in the list
  if (!isAdmin && !isVisibleNow(shelf.visibleFrom, shelf.visibleTo))
    return null;
  const entries = (await prisma.shelfEntry.findMany({
    where: { shelfId: id },
    select: entryRowSelect,
  })) as ShelfEntryRow[];
  const refs = await loadLibraryRefs(entries);
  const seasons = await loadLibrarySeasons(entries);
  const views = mapShelfEntries(
    entries,
    refs,
    orderModeOf(shelf.orderMode),
    isAdmin,
    seasons,
  );
  const summary = mapShelfSummary({
    shelf,
    entries: views,
    backdropUrl: await coverBackdropUrl(shelf),
  });
  return mapShelfDetail(summary, views);
}

export function seedSummaries(language: SeedLanguage): ShelfSeedSummary[] {
  return listSeeds().map((seed) => ({
    key: seed.key,
    name: seed.name[language],
    description: seed.description[language],
    order_mode: seed.orderMode,
    home_row: seed.homeRow,
    visible_from: seed.visibleFrom,
    visible_to: seed.visibleTo,
  }));
}

async function nextShelfPosition(): Promise<number> {
  const last = await prisma.shelf.findFirst({
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

export type CreateShelfResult =
  | { ok: true; id: number }
  | {
      ok: false;
      reason: "seed_not_found" | "tmdb_not_configured" | "empty_seed";
    };

/** Create a shelf, either empty or filled once from a seed. */
export async function createShelf(
  input: CreateShelfInput,
  language: SeedLanguage,
): Promise<CreateShelfResult> {
  const seed = input.seed ? findSeed(input.seed) : null;
  if (input.seed && !seed) return { ok: false, reason: "seed_not_found" };

  // Load a seed before writing anything, so a TMDB failure creates no shelf. A
  // curated seed reads the repo, so it installs on an instance with no TMDB key.
  const seedEntries = seed
    ? await (async () => {
        const apiKey = (seed.needsTmdb ? await fetchShelfTmdbKey() : "") ?? "";
        if (seed.needsTmdb && !apiKey) return "tmdb_not_configured" as const;
        const entries = await seed.load(apiKey);
        return entries.length ? entries : ("empty_seed" as const);
      })()
    : [];
  if (seedEntries === "tmdb_not_configured") {
    return { ok: false, reason: "tmdb_not_configured" };
  }
  if (seedEntries === "empty_seed") return { ok: false, reason: "empty_seed" };

  const name = input.name?.trim() || seed?.name[language] || "";
  const position = await nextShelfPosition();
  const created = await prisma.shelf.create({
    data: {
      name,
      description:
        input.description !== undefined
          ? input.description
          : (seed?.description[language] ?? null),
      orderMode: input.orderMode ?? seed?.orderMode ?? "manual",
      coverStyle: input.coverStyle ?? "mosaic",
      coverTmdbId: input.coverTmdbId ?? null,
      coverType: input.coverType ?? null,
      homeRow: input.homeRow ?? seed?.homeRow ?? false,
      visibleFrom: input.visibleFrom ?? seed?.visibleFrom ?? null,
      visibleTo: input.visibleTo ?? seed?.visibleTo ?? null,
      seedKey: seed?.key ?? null,
      position,
    },
    select: { id: true },
  });

  if (Array.isArray(seedEntries)) {
    await prisma.shelfEntry.createMany({
      data: seedEntries.map((entry, index) => ({
        shelfId: created.id,
        tmdbId: entry.tmdbId,
        type: entry.type,
        season: entry.season,
        position: index,
        groupLabel: entry.groupLabel,
        source: "manual",
        title: entry.title,
        year: entry.year,
        posterPath: entry.posterPath,
      })),
      skipDuplicates: true,
    });
  }
  return { ok: true, id: created.id };
}

export async function updateShelf(
  id: number,
  patch: ShelfPatch,
): Promise<boolean> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.orderMode !== undefined) data.orderMode = patch.orderMode;
  if (patch.coverStyle !== undefined) data.coverStyle = patch.coverStyle;
  if (patch.coverTmdbId !== undefined) data.coverTmdbId = patch.coverTmdbId;
  if (patch.coverType !== undefined) data.coverType = patch.coverType;
  if (patch.homeRow !== undefined) data.homeRow = patch.homeRow;
  if (patch.visibleFrom !== undefined) data.visibleFrom = patch.visibleFrom;
  if (patch.visibleTo !== undefined) data.visibleTo = patch.visibleTo;
  if (!Object.keys(data).length) return true;
  const result = await prisma.shelf.updateMany({ where: { id }, data });
  return result.count > 0;
}

export async function deleteShelf(id: number): Promise<boolean> {
  const result = await prisma.shelf.deleteMany({ where: { id } });
  return result.count > 0;
}

/** Move shelves into the given order; every id must exist. */
export async function reorderShelves(ids: number[]): Promise<boolean> {
  const rows = await prisma.shelf.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (rows.length !== new Set(ids).size) return false;
  await prisma.$transaction(
    ids.map((id, position) =>
      prisma.shelf.update({ where: { id }, data: { position } }),
    ),
  );
  return true;
}
