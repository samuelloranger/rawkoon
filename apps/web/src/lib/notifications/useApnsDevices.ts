import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";
import type { ApnsDevicesResponse } from "@rawkoon/shared/types";

export function useApnsDevices(
  options?: Omit<UseQueryOptions<ApnsDevicesResponse>, "queryKey" | "queryFn">,
) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.notifications.apnsDevices(),
    queryFn: () =>
      fetcher<ApnsDevicesResponse>(NOTIFICATION_ENDPOINTS.APNS_DEVICES),
    staleTime: 5 * 60_000,
    ...options,
  });
}
