import { useUrlState } from "@/lib/app/useUrlState";
import type {
  FilterType,
  FilterStatus,
  SortKey,
  SortDir,
  ViewMode,
} from "@/utils/libraryUtils";

const LIBRARY_DEFAULTS = {
  type: "all" as FilterType,
  status: "all" as FilterStatus,
  language: "all" as string,
  search: "" as string,
  sortBy: "added_at" as SortKey,
  sortDir: "desc" as SortDir,
  viewMode: "grid" as ViewMode,
};

export type LibraryPageSearchParams = Partial<typeof LIBRARY_DEFAULTS>;

export function useLibraryPageState(searchParams: LibraryPageSearchParams) {
  const { state, setState } = useUrlState(
    "/library/",
    searchParams,
    LIBRARY_DEFAULTS,
  );

  const activeFilterCount = [
    state.type !== "all",
    state.status !== "all",
    state.language !== "all",
  ].filter(Boolean).length;

  return { state, setState, activeFilterCount };
}
