import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { FanartIntegrationUpdateResponse } from "@rawkoon/shared/types";

export function useUpdateFanartIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { api_key: string; enabled: boolean }) =>
      fetcher<FanartIntegrationUpdateResponse>(INTEGRATION_ENDPOINTS.FANART, {
        method: "PUT",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.fanart(),
      });
      // Artwork candidate lists change when the source is toggled.
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
