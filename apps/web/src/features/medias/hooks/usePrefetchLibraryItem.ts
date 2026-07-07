import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS, LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import { webFetcher } from "@/lib/api/fetcher";
import type {
  LibraryItemResponse,
  LibraryMedia,
  MediaModalDataResponse,
} from "@rawkoon/shared/types";

/**
 * Prefetch both the JS chunk and TMDB modal data for a library item on hover.
 * Since the library list is already in cache (we're on the library page),
 * the only missing data for the detail page is the TMDB enrichment.
 */
export function usePrefetchLibraryItem() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useCallback(
    (item: LibraryMedia) => {
      const mediaType = item.type === "show" ? "tv" : "movie";

      // Preload the JS chunk for the detail route
      void router.preloadRoute({
        to: "/library/$libraryId",
        params: { libraryId: String(item.id) },
      });

      // Prefetch the authoritative by-id payload the detail page reads.
      void queryClient.prefetchQuery({
        queryKey: queryKeys.library.item(item.id),
        queryFn: () =>
          webFetcher<LibraryItemResponse>(LIBRARY_ENDPOINTS.ITEM(item.id)),
        staleTime: 60 * 1000,
      });

      // Prefetch TMDB modal data (the main missing piece on the detail page)
      if (item.tmdb_id) {
        void queryClient.prefetchQuery({
          queryKey: queryKeys.medias.modalData(mediaType, item.tmdb_id),
          queryFn: () =>
            webFetcher<MediaModalDataResponse>(
              MEDIAS_ENDPOINTS.MODAL_DATA(mediaType, item.tmdb_id!),
            ),
          staleTime: 60 * 1000,
        });
      }
    },
    [router, queryClient],
  );
}
