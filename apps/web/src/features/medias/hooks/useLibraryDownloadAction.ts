import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

type DownloadAction = "pause" | "resume" | "remove";

export function useLibraryDownloadAction(libraryId: number) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: {
      dhId: number;
      action: DownloadAction;
      delete_files?: boolean;
    }) =>
      fetcher<{ success: boolean }>(
        LIBRARY_ENDPOINTS.DOWNLOAD_ACTION(libraryId, vars.dhId),
        {
          method: "POST",
          body: JSON.stringify({
            action: vars.action,
            delete_files: vars.delete_files,
          }),
        },
      ),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.downloads(libraryId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.attention(),
      });
    },
  });
}
