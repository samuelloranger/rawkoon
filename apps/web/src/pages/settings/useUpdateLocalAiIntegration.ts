import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { LocalAiIntegrationUpdateResponse } from "@rawkoon/shared/types";

export function useUpdateLocalAiIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { base_url: string; model: string; enabled: boolean }) =>
      fetcher<LocalAiIntegrationUpdateResponse>(
        INTEGRATION_ENDPOINTS.LOCAL_AI,
        {
          method: "PUT",
          body: data,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.localAi(),
      });
    },
  });
}
