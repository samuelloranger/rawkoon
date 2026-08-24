import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import type {
  BookItemResponse,
  BookOverridesRequest,
} from "@rawkoon/shared/types";

/**
 * Set or clear manual metadata overrides on a book.
 *
 * A null (or empty) value clears the override and hands the field back to the
 * metadata source chain, so the server re-merges and the response carries the
 * resulting book.
 */
export function useUpdateBookOverrides(bookId: number) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (overrides: BookOverridesRequest) =>
      fetcher<BookItemResponse>(BOOKS_ENDPOINTS.OVERRIDES(bookId), {
        method: "PATCH",
        body: overrides,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.books.detail(bookId),
      });
      // The list shows title, series and cover, all of which an override moves.
      void queryClient.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}
