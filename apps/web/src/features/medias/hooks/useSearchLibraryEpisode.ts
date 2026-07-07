import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibrarySearchResponse } from "@rawkoon/shared/types";

export function useSearchLibraryEpisode() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      mediaId,
      episodeId,
      search_query,
    }: {
      mediaId: number;
      episodeId: number;
      search_query?: string;
    }) =>
      fetcher<LibrarySearchResponse>(
        LIBRARY_ENDPOINTS.SEARCH_EPISODE(mediaId, episodeId),
        {
          method: "POST",
          body:
            search_query !== undefined && search_query !== ""
              ? { search_query }
              : {},
        },
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.episodes(vars.mediaId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.downloads(vars.mediaId),
      });
    },
  });
}
