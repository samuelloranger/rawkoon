import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useRetryLibraryPostProcess() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (downloadHistoryId: number) =>
      fetcher<{ queued: boolean; download_history_id: number }>(
        LIBRARY_ENDPOINTS.RETRY_POST_PROCESS(downloadHistoryId),
        { method: "POST" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.attention(),
      });
    },
  });
}
