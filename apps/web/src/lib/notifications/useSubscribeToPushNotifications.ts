import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";

export function useSubscribeToPushNotifications() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      subscription,
      deviceInfo,
    }: {
      subscription: Record<string, unknown>;
      deviceInfo?: Record<string, unknown>;
    }) =>
      fetcher<{ success: boolean; message: string }>(
        NOTIFICATION_ENDPOINTS.SUBSCRIBE,
        {
          method: "POST",
          body: {
            subscription,
            device_info: deviceInfo,
          },
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.devices(),
      });
    },
  });
}
