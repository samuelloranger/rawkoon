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

export function useMarkAsReadOptimistic() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: number) =>
      fetcher<ApiResult<{ message: string }>>(
        NOTIFICATION_ENDPOINTS.MARK_READ(notificationId),
        {
          method: "PUT",
        },
      ),
    onMutate: async (notificationId) => {
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

          if ("pages" in old) {
            return {
              ...old,
              pages: old.pages.map((page: NotificationsResponse) => ({
                ...page,
                notifications: (page.notifications || []).map(
                  (n: Notification) =>
                    n.id === notificationId
                      ? { ...n, read: true, read_at: new Date().toISOString() }
                      : n,
                ),
              })),
            };
          }

          if (Array.isArray(old.notifications)) {
            return {
              ...old,
              notifications: old.notifications.map((n: Notification) =>
                n.id === notificationId
                  ? { ...n, read: true, read_at: new Date().toISOString() }
                  : n,
              ),
            };
          }

          return old;
        },
      );

      queryClient.setQueryData(
        queryKeys.notifications.unreadCount(),
        (old: { unread_count: number } | undefined) => {
          if (!old) return { unread_count: 0 };
          return { unread_count: Math.max(0, old.unread_count - 1) };
        },
      );

      return { previousNotifications };
    },
    onError: (_err, _notificationId, context) => {
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
