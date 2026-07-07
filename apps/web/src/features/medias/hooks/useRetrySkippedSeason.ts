import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useRetrySkippedSeason() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ mediaId, season }: { mediaId: number; season: number }) =>
      fetcher<{ retried: number }>(
        LIBRARY_ENDPOINTS.RETRY_SKIPPED_SEASON(mediaId, season),
        { method: "POST" },
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.episodes(vars.mediaId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.attention(),
      });
    },
  });
}
