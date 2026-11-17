import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useDeleteLibraryFile(_libraryId: number) {
  return useLibraryMutation<
    { fileId: number; deleteFile: boolean },
    { success: boolean }
  >(({ fileId, deleteFile }) => [
    `${LIBRARY_ENDPOINTS.DELETE_FILE(fileId)}${deleteFile ? "?delete_file=true" : ""}`,
    { method: "DELETE" },
  ]);
}
