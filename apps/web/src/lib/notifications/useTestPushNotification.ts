import { useMutation } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";

export function useTestPushNotification() {
  const fetcher = useFetcher();

  return useMutation({
    mutationFn: () =>
      fetcher<{ success: boolean; message: string }>(
        NOTIFICATION_ENDPOINTS.TEST,
        {
          method: "POST",
        },
      ),
  });
}
