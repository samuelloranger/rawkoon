import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { ProwlarrIntegration } from "@rawkoon/shared/types";

export function useProwlarrIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.prowlarr(),
    queryFn: () =>
      fetcher<{ integration: ProwlarrIntegration }>(
        INTEGRATION_ENDPOINTS.PROWLARR,
      ),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
