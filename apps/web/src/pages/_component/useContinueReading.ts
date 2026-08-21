import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import type { BookReadingResponse } from "@rawkoon/shared/types";

/**
 * Books the user is partway through, newest position first. Backs the home
 * "Continue reading" widget.
 *
 * Short stale time rather than a poll: a position saved on the phone should
 * appear on the desktop when the dashboard is next looked at, and reading
 * positions do not change while nobody is reading.
 */
export function useContinueReading(limit = 6) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.books.reading(limit),
    queryFn: () => fetcher<BookReadingResponse>(BOOKS_ENDPOINTS.READING(limit)),
    staleTime: 30_000,
  });
}
