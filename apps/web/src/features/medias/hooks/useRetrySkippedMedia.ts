import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryMedia } from "@rawkoon/shared/types";

export function useRetrySkippedMedia() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, { mediaId: number; episodeId?: number }>({
    mutationFn: ({ mediaId, episodeId }) => {
      if (episodeId !== undefined) {
        return fetcher<{
          episode: { id: number; status: string; search_attempts: number };
        }>(LIBRARY_ENDPOINTS.UPDATE_EPISODE_STATUS(mediaId, episodeId), {
          method: "PATCH",
          body: { status: "wanted" },
        });
      }
      return fetcher<{ item: LibraryMedia }>(
        LIBRARY_ENDPOINTS.UPDATE_STATUS(mediaId),
        { method: "PATCH", body: { status: "wanted" } },
      );
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.attention(),
      });
      if (vars.episodeId !== undefined) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.library.episodes(vars.mediaId),
        });
      }
    },
  });
}
