import { useQuery } from "@tanstack/react-query";
import type { DownloadClientIntegration } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useDownloadClientIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.downloadClient(),
    queryFn: () =>
      fetcher<{ integration: DownloadClientIntegration }>(
        INTEGRATION_ENDPOINTS.DOWNLOAD_CLIENT,
      ),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
