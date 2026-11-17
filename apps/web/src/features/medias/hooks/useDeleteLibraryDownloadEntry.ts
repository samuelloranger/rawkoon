import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useDeleteLibraryDownloadEntry(libraryId: number) {
  return useLibraryMutation<number, { success: boolean }>(
    (downloadHistoryId) => [
      LIBRARY_ENDPOINTS.DELETE_DOWNLOAD_ENTRY(libraryId, downloadHistoryId),
      { method: "DELETE" },
    ],
  );
}
