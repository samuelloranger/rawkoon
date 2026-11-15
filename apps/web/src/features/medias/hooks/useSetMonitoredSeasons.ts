import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SeasonMode } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useSetMonitoredSeasons(mediaId: number) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      /** Absent = only the new-season flag changes. */
      season_mode?: SeasonMode;
      seasons?: number[];
      monitor_new_seasons: boolean;
    }) =>
      fetcher<{ monitor_new_seasons: boolean }>(
        LIBRARY_ENDPOINTS.UPDATE_MONITORED_SEASONS(mediaId),
        { method: "PATCH", body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.library.episodes(mediaId),
      });
    },
  });
}
