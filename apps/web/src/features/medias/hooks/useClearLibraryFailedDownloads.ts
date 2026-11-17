import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useClearLibraryFailedDownloads(libraryId: number) {
  return useLibraryMutation<void, { deleted: number }>(() => [
    LIBRARY_ENDPOINTS.CLEAR_FAILED_DOWNLOADS(libraryId),
    { method: "DELETE" },
  ]);
}
