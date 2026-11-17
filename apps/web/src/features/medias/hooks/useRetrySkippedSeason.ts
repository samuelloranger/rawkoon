import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useRetrySkippedSeason() {
  return useLibraryMutation<
    { mediaId: number; season: number },
    { retried: number }
  >(({ mediaId, season }) => [
    LIBRARY_ENDPOINTS.RETRY_SKIPPED_SEASON(mediaId, season),
    { method: "POST" },
  ]);
}
