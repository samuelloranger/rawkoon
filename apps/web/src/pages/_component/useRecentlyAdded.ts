import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryListResponse, LibraryMedia } from "@rawkoon/shared/types";

/**
 * Most-recently-added library media, newest first, capped to `limit`.
 * Backed by the user's library (not Jellyfin), ordered by `added_at` desc.
 */
export function useRecentlyAdded(limit = 12) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.library.recentlyAdded(limit),
    queryFn: async (): Promise<LibraryMedia[]> => {
      const data = await fetcher<LibraryListResponse>(LIBRARY_ENDPOINTS.LIST);
      return [...data.items]
        .sort(
          (a, b) =>
            new Date(b.added_at).getTime() - new Date(a.added_at).getTime(),
        )
        .slice(0, limit);
    },
  });
}
