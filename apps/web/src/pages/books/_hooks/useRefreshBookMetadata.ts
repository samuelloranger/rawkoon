import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import type { BookRefreshMetadataResponse } from "@rawkoon/shared/types";

/**
 * Re-run the metadata source chain for one book.
 *
 * There is no scheduled sweep, so this is the only way metadata changes after
 * a book is added.
 */
export function useRefreshBookMetadata(bookId: number) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<BookRefreshMetadataResponse>(
        BOOKS_ENDPOINTS.REFRESH_METADATA(bookId),
        { method: "POST" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.books.detail(bookId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}
