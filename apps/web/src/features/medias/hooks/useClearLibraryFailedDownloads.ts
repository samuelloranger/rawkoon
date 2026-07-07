import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useClearLibraryFailedDownloads(libraryId: number) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetcher<{ deleted: number }>(
        LIBRARY_ENDPOINTS.CLEAR_FAILED_DOWNLOADS(libraryId),
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.attention(),
      });
    },
  });
}
