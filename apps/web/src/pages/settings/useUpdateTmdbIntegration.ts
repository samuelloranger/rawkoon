import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { TmdbIntegrationUpdateResponse } from "@rawkoon/shared/types";

export function useUpdateTmdbIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      api_key: string;
      enabled: boolean;
      popularity_threshold?: number;
    }) =>
      fetcher<TmdbIntegrationUpdateResponse>(INTEGRATION_ENDPOINTS.TMDB, {
        method: "PUT",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.tmdb(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.upcoming(),
      });
    },
  });
}
