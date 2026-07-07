import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { RetryJobResponse } from "@rawkoon/shared/types";

export function useRetryJob() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ queue, jobId }: { queue: string; jobId: string }) =>
      fetcher<RetryJobResponse>(ADMIN_ENDPOINTS.RETRY_JOB(queue, jobId), {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
    },
  });
}
