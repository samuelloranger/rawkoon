import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { ProwlarrIntegrationUpdateResponse } from "@rawkoon/shared/types";

export function useUpdateProwlarrIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      website_url: string;
      api_key: string;
      enabled: boolean;
      rss_indexers?: string[];
    }) =>
      fetcher<ProwlarrIntegrationUpdateResponse>(
        INTEGRATION_ENDPOINTS.PROWLARR,
        {
          method: "PUT",
          body: data,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.prowlarr(),
      });
    },
  });
}
