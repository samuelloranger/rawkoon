import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useRetryLibraryPostProcess() {
  return useLibraryMutation<
    number,
    { queued: boolean; download_history_id: number }
  >((downloadHistoryId) => [
    LIBRARY_ENDPOINTS.RETRY_POST_PROCESS(downloadHistoryId),
    { method: "POST" },
  ]);
}
