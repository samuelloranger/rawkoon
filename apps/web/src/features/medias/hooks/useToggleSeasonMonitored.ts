import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useToggleSeasonMonitored() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      mediaId,
      season,
      monitored,
    }: {
      mediaId: number;
      season: number;
      monitored: boolean;
    }) =>
      fetcher<{ updated: number }>(
        LIBRARY_ENDPOINTS.UPDATE_SEASON_MONITORED(mediaId, season),
        { method: "PATCH", body: { monitored } },
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.episodes(vars.mediaId),
      });
    },
  });
}
