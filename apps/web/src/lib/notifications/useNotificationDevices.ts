import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";
import type { NotificationDevicesResponse } from "@rawkoon/shared/types";

export function useNotificationDevices(
  options?: Omit<
    UseQueryOptions<NotificationDevicesResponse>,
    "queryKey" | "queryFn"
  >,
) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.notifications.devices(),
    queryFn: () =>
      fetcher<NotificationDevicesResponse>(NOTIFICATION_ENDPOINTS.DEVICES),
    staleTime: 5 * 60_000,
    ...options,
  });
}
