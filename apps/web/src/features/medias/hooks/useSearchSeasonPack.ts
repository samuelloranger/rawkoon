import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibrarySearchResponse } from "@rawkoon/shared/types";

export function useSearchSeasonPack() {
  return useLibraryMutation<
    { mediaId: number; season: number; search_query?: string },
    LibrarySearchResponse
  >(({ mediaId, season, search_query }) => [
    LIBRARY_ENDPOINTS.SEARCH_SEASON(mediaId, season),
    { method: "POST", body: search_query ? { search_query } : {} },
  ]);
}
