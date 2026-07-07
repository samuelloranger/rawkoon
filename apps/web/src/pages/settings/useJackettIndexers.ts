import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";

export interface IndexerItem {
  id: number;
  slug: string;
  name: string;
  enabled: boolean;
  privacy: string;
}

export function useJackettIndexers(enabled: boolean) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.jackettIndexers(),
    queryFn: () =>
      fetcher<{ indexers: IndexerItem[] }>(
        INTEGRATION_ENDPOINTS.JACKETT_INDEXERS,
      ),
    enabled,
    staleTime: 60_000,
  });
}
