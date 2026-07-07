import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { WatchlistResponse } from "@rawkoon/shared/types";

export function useWatchlist(options?: { enabled?: boolean }) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.medias.watchlist(),
    queryFn: () => fetcher<WatchlistResponse>(MEDIAS_ENDPOINTS.WATCHLIST),
    enabled: options?.enabled ?? true,
  });
}
