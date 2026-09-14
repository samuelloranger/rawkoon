import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { FanartIntegration } from "@rawkoon/shared/types";

export function useFanartIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.fanart(),
    queryFn: () =>
      fetcher<{ integration: FanartIntegration }>(INTEGRATION_ENDPOINTS.FANART),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
