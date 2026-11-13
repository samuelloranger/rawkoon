import type {
  ShelfEntryView,
  ShelfMediaType,
  ShelfMembership,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import {
  libraryArtwork,
  loadLibraryRefs,
  loadLibrarySeasons,
  mapShelfEntries,
  orderModeOf,
  type ShelfEntryRow,
  type ShelfRow,
} from "./shelfMapping";
import { fetchShelfTitle, fetchShelfTmdbKey } from "./shelfTmdb";
import { shelfRowSelect, entryRowSelect, key } from "./shelfRows";

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
    const seasons = await loadLibrarySeasons([existing]);
    return {
      ok: true,
      entry: mapShelfEntries(
        [existing],
        refs,
        orderModeOf(shelf.orderMode),
        true,
        seasons,
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

  // The lookup above can lose a race with another add of the same title (Postgres
  // treats two NULL seasons as distinct), so the write re-checks under a lock:
  // concurrent adds of one title end with one entry, not two.
  const lock = `shelf-entry:${shelfId}:${input.type}:${input.tmdbId}:${season ?? 0}`;
  const created = (await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
    const raced = (await tx.shelfEntry.findFirst({
      where: { shelfId, tmdbId: input.tmdbId, type: input.type, season },
      select: entryRowSelect,
    })) as ShelfEntryRow | null;
    if (raced) {
      if (raced.excluded) {
        await tx.shelfEntry.update({
          where: { id: raced.id },
          data: { excluded: false, source: "manual" },
        });
        raced.excluded = false;
      }
      return raced;
    }
    const last = await tx.shelfEntry.findFirst({
      where: { shelfId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    // An explicit position inserts there, pushing the titles at or after it down
    if (input.position != null) {
      await tx.shelfEntry.updateMany({
        where: { shelfId, position: { gte: input.position } },
        data: { position: { increment: 1 } },
      });
    }
    return (await tx.shelfEntry.create({
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
  })) as ShelfEntryRow;
  const createdRefs = await loadLibraryRefs([created]);
  const createdSeasons = await loadLibrarySeasons([created]);
  return {
    ok: true,
    entry: mapShelfEntries(
      [created],
      createdRefs,
      orderModeOf(shelf.orderMode),
      true,
      createdSeasons,
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
    select: { id: true, name: true, orderMode: true },
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
      order_mode: orderModeOf(shelf.orderMode),
    };
  });
}
