import { Prisma } from "@prisma/client";

export type LibrarySortBy =
  | "added_at"
  | "last_grabbed_at"
  | "title"
  | "year"
  | "status"
  | "digital_release_date"
  | "file_size";
export type LibrarySortDir = "asc" | "desc";

const VALID_SORT_BY = new Set<LibrarySortBy>([
  "added_at",
  "last_grabbed_at",
  "title",
  "year",
  "status",
  "digital_release_date",
  "file_size",
]);

// Sorts that cannot be a plain column ORDER BY: file_size/last_grabbed_at are
// aggregates over related rows, and title is display-derived (mapLibraryMedia
// renders overrides.title over the raw column). All three are ordered in memory
// over lightweight rows so the order matches what the user actually sees.
const AGGREGATE_SORTS = new Set<LibrarySortBy>([
  "file_size",
  "last_grabbed_at",
  "title",
]);

export function isAggregateSort(sortBy: LibrarySortBy): boolean {
  return AGGREGATE_SORTS.has(sortBy);
}

export function parseLibrarySort(
  sortBy?: string,
  sortDir?: string,
): { sortBy: LibrarySortBy; sortDir: LibrarySortDir } {
  const by: LibrarySortBy = VALID_SORT_BY.has(sortBy as LibrarySortBy)
    ? (sortBy as LibrarySortBy)
    : "added_at";
  const dir: LibrarySortDir = sortDir === "asc" ? "asc" : "desc";
  return { sortBy: by, sortDir: dir };
}

// Non-null simple columns. (title is intentionally absent — it is
// display-derived and ordered in memory; see AGGREGATE_SORTS.)
const PLAIN_COLUMN: Partial<Record<LibrarySortBy, string>> = {
  added_at: "addedAt",
  status: "status",
};
// Nullable simple columns → ordered nulls-last (matches the client's
// null-last intent for these fields).
const NULLABLE_COLUMN: Partial<Record<LibrarySortBy, string>> = {
  year: "year",
  digital_release_date: "digitalReleaseDate",
};

export function buildSimpleOrderBy(
  sortBy: LibrarySortBy,
  sortDir: LibrarySortDir,
): Prisma.LibraryMediaOrderByWithRelationInput[] {
  const plain = PLAIN_COLUMN[sortBy];
  if (plain) {
    return [{ [plain]: sortDir }, { id: sortDir }];
  }
  const nullable = NULLABLE_COLUMN[sortBy];
  if (nullable) {
    return [{ [nullable]: { sort: sortDir, nulls: "last" } }, { id: sortDir }];
  }
  throw new Error(`buildSimpleOrderBy called with aggregate sort: ${sortBy}`);
}

export function slicePage<T>(
  rows: T[],
  limit: number,
): { items: T[]; has_more: boolean } {
  const has_more = rows.length > limit;
  return { items: has_more ? rows.slice(0, limit) : rows, has_more };
}

export interface AggregateSortRow {
  id: number;
  fileSizeTotal: bigint | null;
  lastGrabbedAt: number | null;
  // Mapped (display) title — overrides.title when set, else the raw title.
  titleMapped: string;
}

export function orderAggregateIds(
  rows: AggregateSortRow[],
  sortBy: LibrarySortBy,
  sortDir: LibrarySortDir,
): number[] {
  const sign = sortDir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    let cmp: number;
    if (sortBy === "file_size") {
      // nulls always last, regardless of direction (matches client sort).
      const aNull = a.fileSizeTotal === null;
      const bNull = b.fileSizeTotal === null;
      if (aNull && bNull) cmp = 0;
      else if (aNull) return 1;
      else if (bNull) return -1;
      else
        cmp =
          a.fileSizeTotal! < b.fileSizeTotal!
            ? -1
            : a.fileSizeTotal! > b.fileSizeTotal!
              ? 1
              : 0;
    } else if (sortBy === "title") {
      // Match the client's localeCompare over the mapped (display) title.
      cmp = a.titleMapped.localeCompare(b.titleMapped);
    } else {
      // last_grabbed_at: client treats null as epoch 0 (oldest).
      const aTime = a.lastGrabbedAt ?? 0;
      const bTime = b.lastGrabbedAt ?? 0;
      cmp = aTime - bTime;
    }
    if (cmp !== 0) return sign * cmp;
    return sign * (a.id - b.id);
  });
  return sorted.map((r) => r.id);
}

export function reorderByIds<T extends { id: number }>(
  records: T[],
  orderedIds: number[],
): T[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return orderedIds.map((id) => byId.get(id)).filter((r): r is T => r != null);
}
