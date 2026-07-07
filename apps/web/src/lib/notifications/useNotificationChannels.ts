import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";
import type {
  NotificationChannel,
  NotificationChannelConfig,
  NotificationChannelType,
  NotificationChannelsResponse,
} from "@rawkoon/shared/types";

export function useNotificationChannels() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.notifications.channels(),
    queryFn: () =>
      fetcher<NotificationChannelsResponse>(NOTIFICATION_ENDPOINTS.CHANNELS),
  });
}

export function useCreateNotificationChannel() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      type: NotificationChannelType;
      label: string;
      config: NotificationChannelConfig;
    }) =>
      fetcher<{ channel: NotificationChannel }>(
        NOTIFICATION_ENDPOINTS.CHANNELS,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.channels(),
      });
    },
  });
}

export function useUpdateNotificationChannel() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: number;
      label?: string;
      enabled?: boolean;
      config?: NotificationChannelConfig;
    }) =>
      fetcher<{ channel: NotificationChannel }>(
        NOTIFICATION_ENDPOINTS.CHANNEL(id),
        { method: "PATCH", body: JSON.stringify(data) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.channels(),
      });
    },
  });
}

export function useDeleteNotificationChannel() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetcher<{ success: boolean }>(NOTIFICATION_ENDPOINTS.CHANNEL(id), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.channels(),
      });
    },
  });
}

export function useTestNotificationChannel() {
  const fetcher = useFetcher();
  return useMutation({
    mutationFn: (id: number) =>
      fetcher<{ success: boolean }>(NOTIFICATION_ENDPOINTS.CHANNEL_TEST(id), {
        method: "POST",
      }),
  });
}
