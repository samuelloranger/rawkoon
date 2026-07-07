import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useDeleteLibraryEpisode(libraryId: number) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      mediaId,
      episodeId,
      deleteFile,
    }: {
      mediaId: number;
      episodeId: number;
      deleteFile: boolean;
    }) =>
      fetcher<{ success: boolean }>(
        `${LIBRARY_ENDPOINTS.DELETE_EPISODE(mediaId, episodeId)}${deleteFile ? "?delete_file=true" : ""}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.files(libraryId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.episodes(libraryId),
      });
    },
  });
}
