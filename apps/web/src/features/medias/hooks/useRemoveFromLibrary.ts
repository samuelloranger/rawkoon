import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useRemoveFromLibrary() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      deleteFiles,
      releaseTorrents,
    }: {
      id: number;
      deleteFiles?: boolean;
      releaseTorrents?: boolean;
    }) => {
      const params = new URLSearchParams();
      if (deleteFiles) params.set("delete_files", "true");
      if (releaseTorrents) params.set("release_torrents", "true");
      const qs = params.toString();
      return fetcher<{ success: boolean; released?: number }>(
        qs
          ? `${LIBRARY_ENDPOINTS.REMOVE(id)}?${qs}`
          : LIBRARY_ENDPOINTS.REMOVE(id),
        { method: "DELETE" },
      );
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.medias.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.downloads.all });
    },
  });
}
