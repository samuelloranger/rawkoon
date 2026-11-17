import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useDeleteLibraryEpisode(_libraryId: number) {
  return useLibraryMutation<
    { mediaId: number; episodeId: number; deleteFile: boolean },
    { success: boolean }
  >(({ mediaId, episodeId, deleteFile }) => [
    `${LIBRARY_ENDPOINTS.DELETE_EPISODE(mediaId, episodeId)}${deleteFile ? "?delete_file=true" : ""}`,
    { method: "DELETE" },
  ]);
}
