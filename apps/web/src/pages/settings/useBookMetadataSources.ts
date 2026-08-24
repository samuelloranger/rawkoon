import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import type {
  BookMetadataSource,
  BookMetadataSourceOrderResponse,
} from "@rawkoon/shared/types";

/**
 * The metadata source priority order.
 *
 * The array doubles as the enable list: a source absent from it is disabled.
 * There is no parallel set of booleans that could contradict the order.
 */

export function useBookMetadataSources() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.books.metadataSources(),
    queryFn: () =>
      fetcher<BookMetadataSourceOrderResponse>(BOOKS_ENDPOINTS.METADATA_SOURCES),
  });
}

export function useUpdateBookMetadataSources() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (order: BookMetadataSource[]) =>
      fetcher<BookMetadataSourceOrderResponse>(
        BOOKS_ENDPOINTS.METADATA_SOURCES,
        { method: "PUT", body: { order } },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.books.metadataSources(),
      });
      // Reordering changes what a refresh would produce for every book.
      void queryClient.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}
