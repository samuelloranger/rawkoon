import type {
  ShelfCover,
  ShelfDetail,
  ShelfEntryView,
  ShelfMediaType,
  ShelfOrderMode,
  ShelfSummary,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { posterUrlOf } from "./shelfTmdb";
import { isVisibleNow, sortEntries } from "./shelfVisibility";

export interface ShelfRow {
  id: number;
  name: string;
  description: string | null;
  orderMode: string;
  coverStyle: string;
  coverTmdbId: number | null;
  coverType: string | null;
  coverFile: string | null;
  homeRow: boolean;
  visibleFrom: string | null;
  visibleTo: string | null;
  seedKey: string | null;
  position: number;
}

export interface ShelfEntryRow {
  id: number;
  shelfId: number;
  tmdbId: number;
  type: string;
  season: number | null;
  position: number;
  groupLabel: string | null;
  source: string;
  excluded: boolean;
  title: string;
  year: number | null;
  posterPath: string | null;
  addedAt: Date;
}

export interface LibraryRef {
  id: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overrides: unknown;
}

const overridesOf = (ref: LibraryRef): Record<string, unknown> => {
  const raw = ref.overrides;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
};

const refKey = (type: string, tmdbId: number) => `${type}:${tmdbId}`;

/** Poster and backdrop overrides win over the stored TMDB artwork, as in the library. */
export function libraryArtwork(ref: LibraryRef): {
  posterUrl: string | null;
  backdropUrl: string | null;
  title: string | null;
  year: number | null;
} {
  const ov = overridesOf(ref);
  return {
    posterUrl:
      typeof ov.poster_url === "string" ? ov.poster_url : ref.posterUrl,
    backdropUrl: typeof ov.backdrop_url === "string" ? ov.backdrop_url : null,
    title: typeof ov.title === "string" ? ov.title : ref.title,
    year: typeof ov.year === "number" ? ov.year : ref.year,
  };
}

/**
 * Resolve a shelf's entries against the library in one query. A title the
 * library lacks keeps the title, year and poster stored when it was added.
 */
export async function loadLibraryRefs(
  entries: Array<{ tmdbId: number; type: string }>,
): Promise<Map<string, LibraryRef>> {
  const refs = new Map<string, LibraryRef>();
  if (!entries.length) return refs;
  const tmdbIds = [...new Set(entries.map((e) => e.tmdbId))];
  const rows = await prisma.libraryMedia.findMany({
    where: { tmdbId: { in: tmdbIds } },
    select: {
      id: true,
      tmdbId: true,
      type: true,
      title: true,
      year: true,
      posterUrl: true,
      overrides: true,
    },
  });
  for (const row of rows) {
    refs.set(refKey(row.type, row.tmdbId), {
      id: row.id,
      title: row.title,
      year: row.year,
      posterUrl: row.posterUrl,
      overrides: row.overrides,
    });
  }
  return refs;
}

/** The seasons of each show the library has downloaded, keyed as a ref: `show:tmdbId`. */
export type SeasonAvailability = Map<string, Set<number>>;

/**
 * Which seasons of the shows on a shelf are downloaded. A season entry placed on
 * its own is "in the library" only when that season is, not merely its show.
 */
export async function loadLibrarySeasons(
  entries: Array<{ tmdbId: number; type: string }>,
): Promise<SeasonAvailability> {
  const tmdbIds = [
    ...new Set(entries.filter((e) => e.type === "show").map((e) => e.tmdbId)),
  ];
  const seasons: SeasonAvailability = new Map();
  if (!tmdbIds.length) return seasons;
  const rows = await prisma.libraryMedia.findMany({
    where: { tmdbId: { in: tmdbIds }, type: "show" },
    select: {
      tmdbId: true,
      episodes: {
        where: { status: "downloaded" },
        select: { season: true },
      },
    },
  });
  for (const row of rows) {
    seasons.set(
      refKey("show", row.tmdbId),
      new Set(row.episodes.map((episode) => episode.season)),
    );
  }
  return seasons;
}

export function mapShelfEntry(
  entry: ShelfEntryRow,
  ref: LibraryRef | undefined,
  seasons?: SeasonAvailability,
): ShelfEntryView {
  const art = ref ? libraryArtwork(ref) : null;
  // A whole title needs only the show; a season needs that season downloaded
  const seasonThere =
    entry.season == null ||
    seasons?.get(refKey(entry.type, entry.tmdbId))?.has(entry.season) === true;
  const there = !!ref && seasonThere;
  return {
    id: entry.id,
    tmdb_id: entry.tmdbId,
    type: entry.type === "show" ? "show" : "movie",
    season: entry.season,
    title: art?.title ?? entry.title,
    year: art?.year ?? entry.year,
    poster_url: art ? art.posterUrl : posterUrlOf(entry.posterPath),
    backdrop_url: art?.backdropUrl ?? null,
    group_label: entry.groupLabel,
    position: entry.position,
    in_library: there,
    library_id: there ? (ref?.id ?? null) : null,
    source: entry.source === "rule" ? "rule" : "manual",
    reason: null,
  };
}

export function mapShelfEntries(
  rawEntries: ShelfEntryRow[],
  refs: Map<string, LibraryRef>,
  mode: ShelfOrderMode,
  isAdmin: boolean,
  seasons?: SeasonAvailability,
): ShelfEntryView[] {
  const visible = isAdmin ? rawEntries : rawEntries.filter((e) => !e.excluded);
  return sortEntries(mode, visible).map((entry) =>
    mapShelfEntry(entry, refs.get(refKey(entry.type, entry.tmdbId)), seasons),
  );
}

export function mapShelfCover(
  shelf: ShelfRow,
  entries: ShelfEntryView[],
  backdropUrl: string | null,
  origin: string,
): ShelfCover {
  if (shelf.coverStyle === "upload") {
    // Absolute for the client that asked: a phone and a TV reach the server by different hosts
    return {
      style: "upload",
      url: shelf.coverFile
        ? `${origin}/api/shelves/covers/${shelf.coverFile}`
        : null,
    };
  }
  if (shelf.coverStyle === "backdrop") {
    return { style: "backdrop", backdrop_url: backdropUrl };
  }
  const posters = entries
    .map((e) => e.poster_url)
    .filter((url): url is string => !!url)
    .slice(0, 4);
  return { style: "mosaic", posters };
}

export function mapShelfSummary(input: {
  shelf: ShelfRow;
  entries: ShelfEntryView[];
  backdropUrl: string | null;
  /** The scheme and host the client reached, for an uploaded cover's URL. */
  origin: string;
  now?: Date;
}): ShelfSummary {
  const { shelf, entries, backdropUrl, origin, now } = input;
  return {
    id: shelf.id,
    name: shelf.name,
    description: shelf.description,
    cover: mapShelfCover(shelf, entries, backdropUrl, origin),
    entry_count: entries.length,
    in_library_count: entries.filter((e) => e.in_library).length,
    home_row: shelf.homeRow,
    visible_from: shelf.visibleFrom,
    visible_to: shelf.visibleTo,
    visible_now: isVisibleNow(shelf.visibleFrom, shelf.visibleTo, now),
    order_mode: orderModeOf(shelf.orderMode),
    cover_tmdb_id: shelf.coverTmdbId,
    cover_type:
      shelf.coverType === "show"
        ? "show"
        : shelf.coverType === "movie"
          ? "movie"
          : null,
    seed_key: shelf.seedKey,
  };
}

export function mapShelfDetail(
  summary: ShelfSummary,
  entries: ShelfEntryView[],
): ShelfDetail {
  return { ...summary, entries };
}

export function orderModeOf(value: string): ShelfOrderMode {
  return value === "release" || value === "rating" || value === "added"
    ? value
    : "manual";
}

export function shelfTypeOf(value: string): ShelfMediaType {
  return value === "show" ? "show" : "movie";
}
