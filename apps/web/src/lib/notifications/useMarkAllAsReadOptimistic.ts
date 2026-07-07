import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";
import type {
  Notification,
  NotificationsResponse,
  ApiResult,
} from "@rawkoon/shared/types";

export function useMarkAllAsReadOptimistic() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetcher<ApiResult<{ message: string }>>(
        NOTIFICATION_ENDPOINTS.MARK_ALL_READ,
        {
          method: "PUT",
        },
      ),
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.notifications.all,
      });

      const previousNotifications = queryClient.getQueriesData({
        queryKey: queryKeys.notifications.all,
      });

      queryClient.setQueriesData(
        { queryKey: queryKeys.notifications.all },
        (
          old:
            | NotificationsResponse
            | InfiniteData<NotificationsResponse>
            | undefined,
        ) => {
          if (!old) return old;

          const markAsRead = (n: Notification): Notification => ({
            ...n,
            read: true,
            read_at: n.read_at || new Date().toISOString(),
          });

          if ("pages" in old) {
            return {
              ...old,
              pages: old.pages.map((page: NotificationsResponse) => ({
                ...page,
                notifications: (page.notifications || []).map(markAsRead),
              })),
            };
          }

          if (Array.isArray(old.notifications)) {
            return {
              ...old,
              notifications: old.notifications.map(markAsRead),
            };
          }

          return old;
        },
      );

      queryClient.setQueryData(queryKeys.notifications.unreadCount(), {
        unread_count: 0,
      });

      return { previousNotifications };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousNotifications) {
        context.previousNotifications.forEach(
          ([queryKey, data]: [readonly unknown[], unknown]) => {
            queryClient.setQueryData(queryKey, data);
          },
        );
      }
    },
    onSettled: () => {
      // Refresh only the notification lists (flat + infinite) and the unread
      // count — not devices/channels/vapid, which live under the same prefix.
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.unreadCount(),
      });
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.notifications.all, "list"],
      });
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.notifications.all, "infinite"],
      });
    },
  });
}
