import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { QbittorrentIntegration } from "@rawkoon/shared/types";

export function useQbittorrentIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.qbittorrent(),
    queryFn: () =>
      fetcher<{ integration: QbittorrentIntegration }>(
        INTEGRATION_ENDPOINTS.QBITTORRENT,
      ),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
