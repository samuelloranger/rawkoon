import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { AiProviderIntegration } from "@rawkoon/shared/types";

export function useAiProviderIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.aiProvider(),
    queryFn: () =>
      fetcher<{ integration: AiProviderIntegration }>(
        INTEGRATION_ENDPOINTS.AI_PROVIDER,
      ),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
