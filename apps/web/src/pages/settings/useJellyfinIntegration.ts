import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { JellyfinIntegration } from "@rawkoon/shared/types";

export function useJellyfinIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.jellyfin(),
    queryFn: () =>
      fetcher<{ integration: JellyfinIntegration }>(
        INTEGRATION_ENDPOINTS.JELLYFIN,
      ),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
