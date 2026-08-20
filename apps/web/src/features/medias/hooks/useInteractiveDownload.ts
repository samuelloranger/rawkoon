import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { MediaInteractiveDownloadResponse } from "@rawkoon/shared/types";

export function useInteractiveDownload() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { token: string }) =>
      fetcher<MediaInteractiveDownloadResponse>(
        MEDIAS_ENDPOINTS.INTERACTIVE_SEARCH_DOWNLOAD,
        {
          method: "POST",
          body: {
            token: params.token,
          },
        },
      ),
    onSuccess: () => {
      // A grab moves the item to downloading, which the list and the dashboard
      // both display. Previously this invalidated nothing at all.
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
