import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryScanResponse } from "@rawkoon/shared/types";

export function useLibraryScan() {
  return useLibraryMutation<
    { path: string; type: "movie" | "show" },
    LibraryScanResponse
  >((body) => [LIBRARY_ENDPOINTS.SCAN, { method: "POST", body }]);
}
