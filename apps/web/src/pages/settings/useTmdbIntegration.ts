import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { TmdbIntegration } from "@rawkoon/shared/types";

export function useTmdbIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.tmdb(),
    queryFn: () =>
      fetcher<{ integration: TmdbIntegration }>(INTEGRATION_ENDPOINTS.TMDB),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
