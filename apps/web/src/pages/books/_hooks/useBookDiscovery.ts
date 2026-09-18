import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import type {
  BookDiscoveryBook,
  BookDiscoveryResponse,
  BookDiscoverySourcesResponse,
} from "@rawkoon/shared/types";

/** The configured discovery sources and their lists — drives the UI toggles. */
export function useBookDiscoverySources() {
  return useQuery({
    queryKey: queryKeys.books.discoverySources(),
    queryFn: () =>
      fetchApi<BookDiscoverySourcesResponse>(BOOKS_ENDPOINTS.DISCOVERY_SOURCES),
    staleTime: 60 * 60 * 1000,
  });
}

/** A ranked, enriched bestseller list for one source + list. */
export function useBookDiscovery(source: string, list: string) {
  return useQuery({
    queryKey: queryKeys.books.discovery(source, list),
    queryFn: () =>
      fetchApi<BookDiscoveryResponse>(
        `${BOOKS_ENDPOINTS.DISCOVERY}?source=${encodeURIComponent(source)}&list=${encodeURIComponent(list)}`,
      ),
    enabled: Boolean(source && list),
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * Add a discovered book. Sends the scraped metadata so a title Google Books does
 * not index is still created; the server prefers the Google volume when present.
 */
export function useAddDiscoveryBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (book: BookDiscoveryBook) =>
      fetchApi<{ added: boolean; book_id: number }>(
        BOOKS_ENDPOINTS.DISCOVERY_ADD,
        {
          method: "POST",
          body: JSON.stringify({
            volume_id: book.volumeId,
            isbn13: book.isbn13,
            title: book.title,
            author: book.author,
            overview: book.overview,
            cover_url: book.coverUrl,
            published_year: book.publishedYear,
          }),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}
