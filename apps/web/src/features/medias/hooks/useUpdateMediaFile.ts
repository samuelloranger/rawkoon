import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useUpdateMediaFile() {
  return useLibraryMutation<
    { fileId: number; release_group: string | null },
    { id: number; release_group: string | null }
  >(({ fileId, release_group }) => [
    LIBRARY_ENDPOINTS.UPDATE_FILE(fileId),
    { method: "PATCH", body: { release_group } },
  ]);
}
