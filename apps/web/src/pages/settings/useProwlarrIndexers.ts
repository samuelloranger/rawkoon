import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { IndexerItem } from "./useJackettIndexers";

export function useProwlarrIndexers(enabled: boolean) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.prowlarrIndexers(),
    queryFn: () =>
      fetcher<{ indexers: IndexerItem[] }>(
        INTEGRATION_ENDPOINTS.PROWLARR_INDEXERS,
      ),
    enabled,
    staleTime: 60_000,
  });
}
