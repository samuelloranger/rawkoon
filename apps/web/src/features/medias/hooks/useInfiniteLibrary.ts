import { useInfiniteQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryListResponse } from "@rawkoon/shared/types";

export const LIBRARY_PAGE_SIZE = 60;

export interface LibraryInfiniteFilters {
  type?: string;
  status?: string;
  q?: string;
  language?: string;
  sortBy?: string;
  sortDir?: string;
}

export function useInfiniteLibrary(filters?: LibraryInfiniteFilters) {
  const fetcher = useFetcher();

  return useInfiniteQuery({
    queryKey: queryKeys.library.infinite(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("page", String(pageParam));
      params.set("limit", String(LIBRARY_PAGE_SIZE));
      if (filters?.type) params.set("type", filters.type);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.q) params.set("q", filters.q);
      if (filters?.language) params.set("language", filters.language);
      if (filters?.sortBy) params.set("sort_by", filters.sortBy);
      if (filters?.sortDir) params.set("sort_dir", filters.sortDir);
      return fetcher<LibraryListResponse>(
        `${LIBRARY_ENDPOINTS.LIST}?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.has_more ? allPages.length + 1 : undefined,
    initialPageParam: 1,
  });
}
