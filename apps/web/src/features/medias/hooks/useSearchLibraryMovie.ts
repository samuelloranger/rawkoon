import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibrarySearchResponse } from "@rawkoon/shared/types";

export function useSearchLibraryMovie() {
  return useLibraryMutation<
    { id: number; search_query?: string },
    LibrarySearchResponse
  >(({ id, search_query }) => [
    LIBRARY_ENDPOINTS.SEARCH(id),
    {
      method: "POST",
      body:
        search_query !== undefined && search_query !== ""
          ? { search_query }
          : {},
    },
  ]);
}
