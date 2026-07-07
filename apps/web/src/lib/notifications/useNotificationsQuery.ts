import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";
import type { NotificationsResponse } from "@rawkoon/shared/types";

export function useNotifications(
  page: number = 1,
  limit: number = 20,
  readFilter?: boolean,
) {
  const fetcher = useFetcher();

  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  if (readFilter !== undefined) {
    params.append("read", readFilter.toString());
  }

  return useQuery({
    queryKey: queryKeys.notifications.list(page, limit, readFilter),
    queryFn: () =>
      fetcher<NotificationsResponse>(
        `${NOTIFICATION_ENDPOINTS.LIST}?${params.toString()}`,
      ),
    staleTime: 30_000,
  });
}
