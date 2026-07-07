import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";

export function useRemoveFromWatchlist() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tmdb_id,
      media_type,
    }: {
      tmdb_id: number;
      media_type: "movie" | "tv";
    }) =>
      fetcher<{ success: boolean }>(
        MEDIAS_ENDPOINTS.WATCHLIST_REMOVE(tmdb_id, media_type),
        {
          method: "DELETE",
        },
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.medias.watchlist() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.medias.modalDataAll(
          variables.media_type,
          variables.tmdb_id,
        ),
      });
    },
  });
}
