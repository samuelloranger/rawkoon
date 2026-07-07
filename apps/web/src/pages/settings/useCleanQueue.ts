import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { CleanQueueResponse } from "@rawkoon/shared/types";

export function useCleanQueue() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      queue,
      status,
      grace,
    }: {
      queue: string;
      status: string;
      grace?: number;
    }) =>
      fetcher<CleanQueueResponse>(
        ADMIN_ENDPOINTS.CLEAN_QUEUE(queue, status, grace),
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
    },
  });
}
