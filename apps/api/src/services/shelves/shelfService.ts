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

const BACKDROP_TTL = 24 * 60 * 60;

const shelfRowSelect = {
  id: true,
  name: true,
  description: true,
  orderMode: true,
  coverStyle: true,
  coverTmdbId: true,
  coverType: true,
  homeRow: true,
  visibleFrom: true,
  visibleTo: true,
  seedKey: true,
  position: true,
} as const;

const entryRowSelect = {
  id: true,
  shelfId: true,
  tmdbId: true,
  type: true,
  season: true,
  position: true,
  groupLabel: true,
  source: true,
  excluded: true,
  title: true,
  year: true,
  posterPath: true,
  addedAt: true,
} as const;

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

const key = (type: string, tmdbId: number) => `${type}:${tmdbId}`;

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
  const entries = (await prisma.shelfEntry.findMany({
    where: { shelfId: id },
    select: entryRowSelect,
  })) as ShelfEntryRow[];
  const refs = await loadLibraryRefs(entries);
  const views = mapShelfEntries(
    entries,
    refs,
    orderModeOf(shelf.orderMode),
    isAdmin,
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

  // Load a seed before writing anything, so a TMDB failure creates no shelf.
  const seedEntries = seed
    ? await (async () => {
        const apiKey = await fetchShelfTmdbKey();
        if (!apiKey) return "tmdb_not_configured" as const;
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

export type AddEntryInput = {
  tmdbId: number;
  type: ShelfMediaType;
  season?: number | null;
  position?: number;
  groupLabel?: string | null;
};

export type AddEntryResult =
  | { ok: true; entry: ShelfEntryView }
  | {
      ok: false;
      reason:
        | "shelf_not_found"
        | "title_not_found"
        | "tmdb_not_configured"
        | "invalid_season";
    };

export async function addShelfEntry(
  shelfId: number,
  input: AddEntryInput,
): Promise<AddEntryResult> {
  if (input.season != null && input.type !== "show") {
    return { ok: false, reason: "invalid_season" };
  }
  const season = input.season ?? null;
  const shelf = (await prisma.shelf.findUnique({
    where: { id: shelfId },
    select: shelfRowSelect,
  })) as ShelfRow | null;
  if (!shelf) return { ok: false, reason: "shelf_not_found" };

  // An existing entry is returned as-is, so the add is idempotent; a title a
  // rule excluded comes back when added by hand.
  const existing = (await prisma.shelfEntry.findFirst({
    where: { shelfId, tmdbId: input.tmdbId, type: input.type, season },
    select: entryRowSelect,
  })) as ShelfEntryRow | null;
  if (existing) {
    if (existing.excluded) {
      await prisma.shelfEntry.update({
        where: { id: existing.id },
        data: { excluded: false, source: "manual" },
      });
      existing.excluded = false;
    }
    const refs = await loadLibraryRefs([existing]);
    return {
      ok: true,
      entry: mapShelfEntries(
        [existing],
        refs,
        orderModeOf(shelf.orderMode),
        true,
      )[0] as ShelfEntryView,
    };
  }

  const refs = await loadLibraryRefs([input]);
  const ref = refs.get(key(input.type, input.tmdbId));
  let title: string;
  let year: number | null;
  let posterPath: string | null = null;
  if (ref) {
    const art = libraryArtwork(ref);
    title = art.title ?? "";
    year = art.year;
  } else {
    const apiKey = await fetchShelfTmdbKey();
    if (!apiKey) return { ok: false, reason: "tmdb_not_configured" };
    const fetched = await fetchShelfTitle(apiKey, input.tmdbId, input.type);
    if (!fetched) return { ok: false, reason: "title_not_found" };
    title = fetched.title;
    year = fetched.year;
    posterPath = fetched.posterPath;
  }
  if (!title) return { ok: false, reason: "title_not_found" };

  const last = await prisma.shelfEntry.findFirst({
    where: { shelfId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const created = (await prisma.shelfEntry.create({
    data: {
      shelfId,
      tmdbId: input.tmdbId,
      type: input.type,
      season,
      position: input.position ?? (last?.position ?? -1) + 1,
      groupLabel: input.groupLabel ?? null,
      source: "manual",
      title,
      year,
      posterPath,
    },
    select: entryRowSelect,
  })) as ShelfEntryRow;
  const createdRefs = await loadLibraryRefs([created]);
  return {
    ok: true,
    entry: mapShelfEntries(
      [created],
      createdRefs,
      orderModeOf(shelf.orderMode),
      true,
    )[0] as ShelfEntryView,
  };
}

export async function reorderShelfEntries(
  shelfId: number,
  moves: Array<{ id: number; position: number; groupLabel: string | null }>,
): Promise<boolean> {
  if (!moves.length) return true;
  const owned = await prisma.shelfEntry.findMany({
    where: { shelfId, id: { in: moves.map((m) => m.id) } },
    select: { id: true },
  });
  if (owned.length !== new Set(moves.map((m) => m.id)).size) return false;
  await prisma.$transaction(
    moves.map((move) =>
      prisma.shelfEntry.update({
        where: { id: move.id },
        data: { position: move.position, groupLabel: move.groupLabel },
      }),
    ),
  );
  return true;
}

/** Remove an entry; a rule-sourced one is excluded instead so rules never re-add it. */
export async function removeShelfEntry(
  shelfId: number,
  entryId: number,
): Promise<"deleted" | "excluded" | "not_found"> {
  const entry = await prisma.shelfEntry.findFirst({
    where: { id: entryId, shelfId },
    select: { id: true, source: true },
  });
  if (!entry) return "not_found";
  if (entry.source === "rule") {
    await prisma.shelfEntry.update({
      where: { id: entry.id },
      data: { excluded: true },
    });
    return "excluded";
  }
  await prisma.shelfEntry.delete({ where: { id: entry.id } });
  return "deleted";
}

/** Shelves for the "Add to shelf" menus, with whether each holds the whole title. */
export async function shelvesForTitle(
  tmdbId: number,
  type: ShelfMediaType,
): Promise<ShelfMembership[]> {
  const shelves = await prisma.shelf.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  const entries = await prisma.shelfEntry.findMany({
    where: { tmdbId, type, season: null },
    select: { id: true, shelfId: true, excluded: true },
  });
  const byShelf = new Map(entries.map((entry) => [entry.shelfId, entry]));
  return shelves.map((shelf) => {
    const entry = byShelf.get(shelf.id);
    const holds = !!entry && !entry.excluded;
    return {
      id: shelf.id,
      name: shelf.name,
      holds,
      entry_id: holds ? (entry?.id ?? null) : null,
    };
  });
}
