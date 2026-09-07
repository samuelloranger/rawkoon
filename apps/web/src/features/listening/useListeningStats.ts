import { useQuery } from "@tanstack/react-query";
import type { BookListeningStats } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints/books";
import { queryKeys } from "@/lib/queryKeys";

export function useListeningStats() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.books.listeningStats(),
    queryFn: () => fetcher<BookListeningStats>(BOOKS_ENDPOINTS.LISTENING_STATS),
  });
}
