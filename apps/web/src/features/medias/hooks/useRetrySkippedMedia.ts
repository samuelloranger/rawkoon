import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useRetrySkippedMedia() {
  return useLibraryMutation<{ mediaId: number; episodeId?: number }>(
    ({ mediaId, episodeId }) => [
      episodeId !== undefined
        ? LIBRARY_ENDPOINTS.UPDATE_EPISODE_STATUS(mediaId, episodeId)
        : LIBRARY_ENDPOINTS.UPDATE_STATUS(mediaId),
      { method: "PATCH", body: { status: "wanted" } },
    ],
  );
}
