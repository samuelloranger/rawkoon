import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryDownloadsResponse } from "@rawkoon/shared/types";

export function useLibraryDownloads(id: number | null) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.library.downloads(id ?? 0),
    queryFn: () =>
      fetcher<LibraryDownloadsResponse>(LIBRARY_ENDPOINTS.DOWNLOADS(id!)),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const anyActive = items.some((r) => !r.completed_at && !r.failed);
      return anyActive ? 3000 : false;
    },
  });
}
