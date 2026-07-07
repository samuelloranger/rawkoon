import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { RetryFailedResponse } from "@rawkoon/shared/types";

export function useRetryFailed() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (queue: string) =>
      fetcher<RetryFailedResponse>(ADMIN_ENDPOINTS.RETRY_FAILED(queue), {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
    },
  });
}
