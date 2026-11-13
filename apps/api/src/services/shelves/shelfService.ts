import { Prisma } from "@prisma/client";
import type {
  ShelfCoverStyle,
  ShelfDetail,
  ShelfEntryView,
  ShelfMediaType,
  ShelfMembership,
  ShelfOrderMode,
  ShelfRules,
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
  rulesOf,
  type ShelfEntryRow,
  type ShelfRow,
} from "./shelfMapping";
import {
  fetchShelfBackdropUrl,
  fetchShelfTitle,
  fetchShelfTmdbKey,
} from "./shelfTmdb";
import { deleteShelfCover } from "./shelfCoverService";
import { findSeed, listSeeds, type SeedLanguage } from "./seeds";
import { entryRowSelect, key, shelfRowSelect } from "./shelfRows";
import { isVisibleNow } from "./shelfVisibility";
import { hasRules } from "./shelfRules";
import { addRuleMatches, attachRuleReasons } from "./shelfRulesService";

const BACKDROP_TTL = 24 * 60 * 60;

export type CreateShelfInput = {
  name?: string;
  description?: string | null;
  seed?: string;
  orderMode?: ShelfOrderMode;
  coverStyle?: ShelfCoverStyle;
  coverTmdbId?: number | null;
  coverType?: ShelfMediaType | null;
  coverUrl?: string | null;
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
  coverUrl: string | null;
  homeRow: boolean;
  visibleFrom: string | null;
  visibleTo: string | null;
  rules: ShelfRules | null;
  autoJoin: boolean;
}>;

/** The chosen cover title's backdrop: a library override first, else TMDB (cached a day). */
async function coverBackdropUrl(shelf: ShelfRow): Promise<string | null> {
  // A picked image wins, so skip the lookups it would never use
  if (shelf.coverStyle !== "backdrop" || !shelf.coverTmdbId || shelf.coverUrl) {
    return null;
  }
  const type: ShelfMediaType = shelf.coverType === "show" ? "show" : "movie";
  const refs = await loadLibraryRefs([{ tmdbId: shelf.coverTmdbId, type }]);
  const ref = refs.get(key(type, shelf.coverTmdbId));
  if (ref) {
    const art = libraryArtwork(ref);
    if (art.backdropUrl) return art.backdropUrl;
  }
  const cacheKey = `shelves:backdrop:${type}:${shelf.coverTmdbId}`;
  const cached = await getJsonCache<{ url: string }>(cacheKey);
  if (cached?.url) return cached.url;
  const apiKey = await fetchShelfTmdbKey();
  const url = apiKey
    ? await fetchShelfBackdropUrl(apiKey, shelf.coverTmdbId, type)
    : null;
  // A miss may be a failed fetch or a missing key: don't pin it for a day
  if (url) await setJsonCache(cacheKey, { url }, BACKDROP_TTL);
  return url;
}

async function summariesOf(
  shelves: ShelfRow[],
  isAdmin: boolean,
  origin: string,
  now = new Date(),
): Promise<ShelfSummary[]> {
  if (!shelves.length) return [];
  const found = (await prisma.shelfEntry.findMany({
    where: { shelfId: { in: shelves.map((s) => s.id) } },
    select: entryRowSelect,
  })) as ShelfEntryRow[];
  // An excluded entry is off the shelf for everyone: it never counts or shows in a cover
  const entries = found.filter((e) => !e.excluded);
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
      false,
      seasons,
    );
    out.push(
      mapShelfSummary({
        shelf,
        entries: views,
        backdropUrl: await coverBackdropUrl(shelf),
        isAdmin,
        origin,
        now,
      }),
    );
  }
  return out;
}

export async function listShelves(
  isAdmin: boolean,
  includeOutsideWindow: boolean,
  origin: string,
): Promise<ShelfSummary[]> {
  const shelves = (await prisma.shelf.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: shelfRowSelect,
  })) as ShelfRow[];
  // Skip shelves outside their window before mapping, not after
  const now = new Date();
  return summariesOf(
    includeOutsideWindow
      ? shelves
      : shelves.filter((s) => isVisibleNow(s.visibleFrom, s.visibleTo, now)),
    isAdmin,
    origin,
    now,
  );
}

export async function getShelfDetail(
  id: number,
  isAdmin: boolean,
  origin: string,
  /** The editor's view: also the entries an admin removed, flagged `excluded`. */
  withExcluded = false,
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
    isAdmin && withExcluded,
    seasons,
  );
  const summary = mapShelfSummary({
    shelf,
    entries: views.filter((v) => !v.excluded),
    backdropUrl: await coverBackdropUrl(shelf),
    isAdmin,
    origin,
  });
  // Reasons are for the editor; everyone else gets rule entries like any other
  return mapShelfDetail(
    summary,
    isAdmin ? await attachRuleReasons(views, rulesOf(shelf.rules)) : views,
  );
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
      reason:
        | "seed_not_found"
        | "tmdb_not_configured"
        | "empty_seed"
        | "seed_failed";
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
        try {
          const entries = await seed.load(apiKey);
          return entries.length || seed.rules || seed.allowEmpty
            ? entries
            : ("empty_seed" as const);
        } catch {
          return "seed_failed" as const;
        }
      })()
    : [];
  if (seedEntries === "tmdb_not_configured") {
    return { ok: false, reason: "tmdb_not_configured" };
  }
  if (seedEntries === "empty_seed") return { ok: false, reason: "empty_seed" };
  if (seedEntries === "seed_failed")
    return { ok: false, reason: "seed_failed" };

  const name = input.name?.trim() || seed?.name[language] || "";
  const position = await nextShelfPosition();
  // The shelf and its entries land together, so a failure never leaves a half-filled shelf
  const created = await prisma.$transaction(async (tx) => {
    const created = await tx.shelf.create({
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
        coverUrl: input.coverUrl ?? null,
        homeRow: input.homeRow ?? seed?.homeRow ?? false,
        visibleFrom: input.visibleFrom ?? seed?.visibleFrom ?? null,
        visibleTo: input.visibleTo ?? seed?.visibleTo ?? null,
        seedKey: seed?.key ?? null,
        rules:
          (seed?.rules as Prisma.InputJsonObject | undefined) ??
          Prisma.JsonNull,
        autoJoin: false,
        position,
      },
      select: { id: true },
    });

    if (Array.isArray(seedEntries)) {
      await tx.shelfEntry.createMany({
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
    return created;
  });
  // A rules seed fills once from whatever facts exist now; an empty library of facts gives an empty shelf
  if (seed?.rules) {
    // The shelf keeps its rules either way; "Seed from rules" can fill it later
    await addRuleMatches(created.id, seed.rules).catch((error) =>
      console.warn(
        `[shelves] seeding shelf ${created.id} from rules failed:`,
        error,
      ),
    );
  }
  return { ok: true, id: created.id };
}

/** Whether the shelf has an uploaded cover file, which the "upload" style needs. */
export async function shelfHasCoverFile(id: number): Promise<boolean> {
  const row = await prisma.shelf.findUnique({
    where: { id },
    select: { coverFile: true },
  });
  return !!row?.coverFile;
}

export type UpdateShelfResult = "ok" | "not_found" | "auto_join_needs_rules";

export async function updateShelf(
  id: number,
  patch: ShelfPatch,
): Promise<UpdateShelfResult> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.orderMode !== undefined) data.orderMode = patch.orderMode;
  if (patch.coverStyle !== undefined) {
    data.coverStyle = patch.coverStyle;
    // Leaving the upload cover drops its file reference and, after the update, the file
    if (patch.coverStyle !== "upload") data.coverFile = null;
    // A picked backdrop belongs to the backdrop style only
    if (patch.coverStyle !== "backdrop") data.coverUrl = null;
  }
  if (patch.coverTmdbId !== undefined) data.coverTmdbId = patch.coverTmdbId;
  if (patch.coverUrl !== undefined) data.coverUrl = patch.coverUrl;
  if (patch.coverType !== undefined) data.coverType = patch.coverType;
  if (patch.homeRow !== undefined) data.homeRow = patch.homeRow;
  if (patch.visibleFrom !== undefined) data.visibleFrom = patch.visibleFrom;
  if (patch.visibleTo !== undefined) data.visibleTo = patch.visibleTo;
  if (patch.rules !== undefined || patch.autoJoin !== undefined) {
    const current = (await prisma.shelf.findUnique({
      where: { id },
      select: { rules: true, autoJoin: true },
    })) as { rules: unknown; autoJoin: boolean } | null;
    if (!current) return "not_found";
    const rules =
      patch.rules !== undefined ? patch.rules : rulesOf(current.rules);
    const ruled = hasRules(rules);
    const autoJoin = patch.autoJoin ?? current.autoJoin;
    if (patch.autoJoin && !ruled) return "auto_join_needs_rules";
    if (patch.rules !== undefined) {
      data.rules = ruled
        ? (patch.rules as Prisma.InputJsonObject)
        : Prisma.JsonNull;
    }
    // Clearing the rules switches auto-join off: nothing is left to match
    if (autoJoin !== current.autoJoin || !ruled)
      data.autoJoin = autoJoin && ruled;
  }
  if (!Object.keys(data).length) return "ok";
  const previous =
    "coverFile" in data
      ? (
          await prisma.shelf.findUnique({
            where: { id },
            select: { coverFile: true },
          })
        )?.coverFile
      : null;
  const result = await prisma.shelf.updateMany({ where: { id }, data });
  await deleteShelfCover(previous ?? null);
  return result.count > 0 ? "ok" : "not_found";
}

/** Makes an uploaded file a shelf's cover. */
export async function setShelfCoverFile(
  id: number,
  file: string,
): Promise<boolean> {
  const previous = (
    await prisma.shelf.findUnique({
      where: { id },
      select: { coverFile: true },
    })
  )?.coverFile;
  const result = await prisma.shelf.updateMany({
    where: { id },
    data: {
      coverStyle: "upload",
      coverFile: file,
      coverTmdbId: null,
      coverType: null,
      coverUrl: null,
    },
  });
  if (previous && previous !== file) await deleteShelfCover(previous);
  return result.count > 0;
}

export async function deleteShelf(id: number): Promise<boolean> {
  const row = await prisma.shelf.findUnique({
    where: { id },
    select: { coverFile: true },
  });
  const result = await prisma.shelf.deleteMany({ where: { id } });
  await deleteShelfCover(row?.coverFile ?? null);
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
