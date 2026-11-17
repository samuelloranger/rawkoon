import { useLibraryMutation } from "./useLibraryMutation";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { MediaInteractiveDownloadResponse } from "@rawkoon/shared/types";

export function useInteractiveDownload() {
  return useLibraryMutation<
    { token: string },
    MediaInteractiveDownloadResponse
  >(
    (params) => [
      MEDIAS_ENDPOINTS.INTERACTIVE_SEARCH_DOWNLOAD,
      { method: "POST", body: { token: params.token } },
    ],
    // A grab moves the item to downloading, which the dashboard also displays.
    { invalidate: () => [queryKeys.dashboard.all] },
  );
}
