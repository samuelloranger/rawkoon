import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibrarySearchResponse } from "@rawkoon/shared/types";

export function useSearchLibraryEpisode() {
  return useLibraryMutation<
    { mediaId: number; episodeId: number; search_query?: string },
    LibrarySearchResponse
  >(({ mediaId, episodeId, search_query }) => [
    LIBRARY_ENDPOINTS.SEARCH_EPISODE(mediaId, episodeId),
    {
      method: "POST",
      body:
        search_query !== undefined && search_query !== ""
          ? { search_query }
          : {},
    },
  ]);
}
