import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { AiProviderIntegrationUpdateResponse } from "@rawkoon/shared/types";

export function useUpdateAiProviderIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      base_url: string;
      model: string;
      api_key?: string;
      enabled: boolean;
      input_price_per_million: number | null;
      output_price_per_million: number | null;
    }) =>
      fetcher<AiProviderIntegrationUpdateResponse>(
        INTEGRATION_ENDPOINTS.AI_PROVIDER,
        {
          method: "PUT",
          body: data,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.aiProvider(),
      });
    },
  });
}
