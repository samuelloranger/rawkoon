import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";
import type { ApiResult } from "@rawkoon/shared/types";

export function useDeleteNotification() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: number) =>
      fetcher<ApiResult<{ message: string }>>(
        NOTIFICATION_ENDPOINTS.DELETE(notificationId),
        {
          method: "DELETE",
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}
