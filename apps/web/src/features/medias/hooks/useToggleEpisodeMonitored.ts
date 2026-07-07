import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useToggleEpisodeMonitored() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      mediaId,
      episodeId,
      monitored,
    }: {
      mediaId: number;
      episodeId: number;
      monitored: boolean;
    }) =>
      fetcher<{ episode: { id: number; monitored: boolean } }>(
        LIBRARY_ENDPOINTS.UPDATE_EPISODE_MONITORED(mediaId, episodeId),
        { method: "PATCH", body: { monitored } },
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.episodes(vars.mediaId),
      });
    },
  });
}
