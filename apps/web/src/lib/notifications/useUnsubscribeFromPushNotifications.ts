import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";

export function useUnsubscribeFromPushNotifications() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (subscription?: Record<string, unknown>) =>
      fetcher<{ success: boolean; message: string }>(
        NOTIFICATION_ENDPOINTS.UNSUBSCRIBE,
        {
          method: "POST",
          body: { subscription },
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.devices(),
      });
    },
  });
}
