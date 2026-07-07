import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";

export function useDeleteNotificationDevice() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (deviceId: number) =>
      fetcher<{ success: boolean; message: string }>(
        NOTIFICATION_ENDPOINTS.DELETE_DEVICE(deviceId),
        {
          method: "DELETE",
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.devices(),
      });
    },
  });
}
