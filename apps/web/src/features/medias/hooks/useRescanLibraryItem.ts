import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useRescanLibraryItem(id: number) {
  return useLibraryMutation<void, { rescanned: number; failed: number }>(() => [
    LIBRARY_ENDPOINTS.RESCAN(id),
    { method: "POST" },
  ]);
}
