import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { AiStatsResponse } from "@rawkoon/shared/types";

export function useAiStats(days: number) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.aiStats(days),
    queryFn: () =>
      fetcher<AiStatsResponse>(INTEGRATION_ENDPOINTS.AI_PROVIDER_STATS(days)),
    staleTime: 30_000,
  });
}
