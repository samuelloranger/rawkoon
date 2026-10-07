import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { AiCallsResponse } from "@rawkoon/shared/types";

export const AI_CALLS_PAGE_SIZE = 20;

export function useAiCalls(opts: {
  page: number;
  feature: string;
  status: string;
}) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.aiCalls(
      opts.page,
      opts.feature,
      opts.status,
    ),
    queryFn: () =>
      fetcher<AiCallsResponse>(
        INTEGRATION_ENDPOINTS.AI_PROVIDER_CALLS({
          page: opts.page,
          pageSize: AI_CALLS_PAGE_SIZE,
          feature: opts.feature || undefined,
          status: opts.status || undefined,
        }),
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
