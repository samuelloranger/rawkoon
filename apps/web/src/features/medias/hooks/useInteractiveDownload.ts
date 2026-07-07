import { useMutation } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { MediaInteractiveDownloadResponse } from "@rawkoon/shared/types";

export function useInteractiveDownload() {
  const fetcher = useFetcher();

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
  });
}
