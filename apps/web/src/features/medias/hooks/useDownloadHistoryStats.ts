import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { DownloadHistoryStatsResponse } from "@rawkoon/shared/types";

export function useDownloadHistoryStats() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.downloadHistoryStats(),
    queryFn: () =>
      fetcher<DownloadHistoryStatsResponse>(
        LIBRARY_ENDPOINTS.DOWNLOAD_HISTORY_STATS,
      ),
    staleTime: 60_000,
  });
}
