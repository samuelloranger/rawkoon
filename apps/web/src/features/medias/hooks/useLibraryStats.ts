import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryStats } from "@rawkoon/shared/types";

export function useLibraryStats() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.stats(),
    // The endpoint wraps the payload as { stats }, so unwrap it here.
    queryFn: () =>
      fetcher<{ stats: LibraryStats }>(LIBRARY_ENDPOINTS.LIBRARY_STATS),
    select: (data) => data.stats,
    staleTime: 60_000,
  });
}
