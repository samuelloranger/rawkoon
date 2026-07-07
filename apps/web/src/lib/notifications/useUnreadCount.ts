import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";
import type { UnreadCountResponse } from "@rawkoon/shared/types";

export function useUnreadCount() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: () =>
      fetcher<UnreadCountResponse>(NOTIFICATION_ENDPOINTS.UNREAD_COUNT),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}
