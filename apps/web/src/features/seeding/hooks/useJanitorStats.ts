import { useQuery } from "@tanstack/react-query";
import type { JanitorStats } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { DOWNLOADS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useJanitorStats() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.downloads.janitorStats(),
    queryFn: () => fetcher<JanitorStats>(DOWNLOADS_ENDPOINTS.JANITOR_STATS),
  });
}
