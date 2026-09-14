import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import { useTitleLanguage } from "@/lib/useTitleLanguage";
import type { LibraryListResponse, LibraryMedia } from "@rawkoon/shared/types";

/**
 * Most-recently-added library media, newest first, capped to `limit`.
 * Backed by the user's library (not Jellyfin), ordered by `added_at` desc.
 */
export function useRecentlyAdded(limit = 24) {
  const fetcher = useFetcher();
  const titleLanguage = useTitleLanguage();

  return useQuery({
    queryKey: queryKeys.library.recentlyAdded(limit, titleLanguage),
    queryFn: async (): Promise<LibraryMedia[]> => {
      const params = new URLSearchParams({
        page: "1",
        limit: String(limit),
        sort_by: "added_at",
        sort_dir: "desc",
        title_language: titleLanguage,
      });
      const data = await fetcher<LibraryListResponse>(
        `${LIBRARY_ENDPOINTS.LIST}?${params.toString()}`,
      );
      return data.items;
    },
  });
}
