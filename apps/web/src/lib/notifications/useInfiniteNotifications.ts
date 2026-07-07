import { useInfiniteQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";
import type { NotificationsResponse } from "@rawkoon/shared/types";

export function useInfiniteNotifications(
  limit: number = 20,
  readFilter?: boolean,
) {
  const fetcher = useFetcher();

  return useInfiniteQuery({
    queryKey: queryKeys.notifications.infinite(limit, readFilter),
    queryFn: ({ pageParam = 1 }) => {
      const params = new URLSearchParams({
        page: String(pageParam),
        limit: String(limit),
      });
      if (readFilter !== undefined) {
        params.append("read", String(readFilter));
      }
      return fetcher<NotificationsResponse>(
        `${NOTIFICATION_ENDPOINTS.LIST}?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => {
      const pagination = lastPage.pagination;
      if (!pagination) return undefined;
      return pagination.page < pagination.pages
        ? pagination.page + 1
        : undefined;
    },
    initialPageParam: 1,
    staleTime: 30_000,
  });
}
