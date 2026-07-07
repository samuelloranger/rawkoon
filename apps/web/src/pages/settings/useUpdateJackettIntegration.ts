import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { JackettIntegrationUpdateResponse } from "@rawkoon/shared/types";

export function useUpdateJackettIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      website_url: string;
      api_key: string;
      enabled: boolean;
      rss_indexers?: string[];
    }) =>
      fetcher<JackettIntegrationUpdateResponse>(INTEGRATION_ENDPOINTS.JACKETT, {
        method: "PUT",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.jackett(),
      });
    },
  });
}
