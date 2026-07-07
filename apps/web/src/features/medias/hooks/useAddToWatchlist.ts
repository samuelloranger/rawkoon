import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";

export function useAddToWatchlist() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      tmdb_id: number;
      media_type: "movie" | "tv";
      title: string;
      poster_url?: string | null;
      overview?: string | null;
      release_year?: number | null;
      vote_average?: number | null;
      /** YYYY-MM-DD (movies); enables day-before release reminder */
      release_date?: string | null;
    }) =>
      fetcher<{ id: number; added: boolean }>(MEDIAS_ENDPOINTS.WATCHLIST, {
        method: "POST",
        body: data,
      }),
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
