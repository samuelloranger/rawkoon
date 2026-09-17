import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import type {
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
