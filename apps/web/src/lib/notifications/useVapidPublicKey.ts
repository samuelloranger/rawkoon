import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";

export function useVapidPublicKey() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.notifications.vapidPublicKey(),
    queryFn: () =>
      fetcher<{ publicKey: string }>(NOTIFICATION_ENDPOINTS.VAPID_PUBLIC_KEY),
    staleTime: Infinity,
  });
}
