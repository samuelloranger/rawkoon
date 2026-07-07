import type { LibraryMedia } from "@rawkoon/shared/types";

export type SortKey =
  | "title"
  | "year"
  | "added_at"
  | "status"
  | "last_grabbed_at"
  | "digital_release_date"
  | "file_size";
export type SortDir = "asc" | "desc";
export type FilterType = "all" | "movie" | "show";
export type ViewMode = "grid" | "compact" | "list";
export type FilterStatus =
  | "all"
  | "wanted"
  | "downloading"
  | "downloaded"
  | "skipped";

export const LIBRARY_SORT_KEYS: readonly SortKey[] = [
  "added_at",
  "last_grabbed_at",
  "title",
  "year",
  "status",
  "digital_release_date",
  "file_size",
] as const;

export function sortItems(
  items: LibraryMedia[],
  sortBy: SortKey,
  sortDir: SortDir,
): LibraryMedia[] {
  return [...items].sort((a, b) => {
    let cmp: number;
    if (sortBy === "title") cmp = a.title.localeCompare(b.title);
    else if (sortBy === "year") cmp = (a.year ?? 0) - (b.year ?? 0);
    else if (sortBy === "status") cmp = a.status.localeCompare(b.status);
    else if (sortBy === "last_grabbed_at") {
      const aTime = a.last_grabbed_at
        ? new Date(a.last_grabbed_at).getTime()
        : 0;
      const bTime = b.last_grabbed_at
        ? new Date(b.last_grabbed_at).getTime()
        : 0;
      cmp = aTime - bTime;
    } else if (sortBy === "digital_release_date") {
      const aNull = a.digital_release_date === null;
      const bNull = b.digital_release_date === null;
      if (aNull && bNull) cmp = 0;
      else if (aNull) return 1;
      else if (bNull) return -1;
      else
        cmp =
          new Date(a.digital_release_date!).getTime() -
          new Date(b.digital_release_date!).getTime();
    } else if (sortBy === "file_size") {
      const aNull = a.total_size_bytes === null;
      const bNull = b.total_size_bytes === null;
      if (aNull && bNull) cmp = 0;
      else if (aNull) return 1;
      else if (bNull) return -1;
      else {
        const aSize = BigInt(a.total_size_bytes!);
        const bSize = BigInt(b.total_size_bytes!);
        cmp = aSize < bSize ? -1 : aSize > bSize ? 1 : 0;
      }
    } else
      cmp = new Date(a.added_at).getTime() - new Date(b.added_at).getTime();
    return sortDir === "asc" ? cmp : -cmp;
  });
}
