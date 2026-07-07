import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { JellyfinIntegrationUpdateResponse } from "@rawkoon/shared/types";

export function useUpdateJellyfinIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      website_url: string;
      api_key: string;
      enabled: boolean;
    }) =>
      fetcher<JellyfinIntegrationUpdateResponse>(
        INTEGRATION_ENDPOINTS.JELLYFIN,
        {
          method: "PUT",
          body: data,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.jellyfin(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.jellyfinNowPlaying(),
      });
    },
  });
}
