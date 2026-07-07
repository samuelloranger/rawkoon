import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { LocalAiIntegration } from "@rawkoon/shared/types";

export function useLocalAiIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.localAi(),
    queryFn: () =>
      fetcher<{ integration: LocalAiIntegration }>(
        INTEGRATION_ENDPOINTS.LOCAL_AI,
      ),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
