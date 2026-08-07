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

/**
 * Prisma ORDER BY for GET /api/library. Aggregate/display sorts use persisted
 * summary columns on library_media (maintained by DB triggers), so list
 * pagination is plain findMany skip/take — no $queryRaw.
 */
export function buildLibraryOrderBy(
  sortBy: LibrarySortBy,
  sortDir: LibrarySortDir,
): Prisma.LibraryMediaOrderByWithRelationInput[] {
  switch (sortBy) {
    case "added_at":
      return [{ addedAt: sortDir }, { id: sortDir }];
    case "status":
      return [{ status: sortDir }, { id: sortDir }];
    case "digital_release_date":
      return [
        { digitalReleaseDate: { sort: sortDir, nulls: "last" } },
        { id: sortDir },
      ];
    case "title":
      return [{ listTitle: sortDir }, { id: sortDir }];
    case "year":
      return [{ listYear: { sort: sortDir, nulls: "last" } }, { id: sortDir }];
    case "file_size":
      // nulls always last (no files → null total), regardless of direction.
      return [
        { totalSizeBytes: { sort: sortDir, nulls: "last" } },
        { id: sortDir },
      ];
    case "last_grabbed_at":
      // null treated as oldest (epoch): asc → nulls first, desc → nulls last.
      return [
        {
          lastGrabbedAt: {
            sort: sortDir,
            nulls: sortDir === "asc" ? "first" : "last",
          },
        },
        { id: sortDir },
      ];
  }
}

export function slicePage<T>(
  rows: T[],
  limit: number,
): { items: T[]; has_more: boolean } {
  const has_more = rows.length > limit;
  return { items: has_more ? rows.slice(0, limit) : rows, has_more };
}
