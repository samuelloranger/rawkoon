import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export interface StreamNotification {
  id: number;
  title: string;
  body: string;
  type: string;
  url: string | null;
  imageUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface UseNotificationStreamOptions {
  /** Called for each new notification pushed over the stream. */
  onNotification: (notification: StreamNotification) => void;
  /**
   * Reconnect token — when it changes, the stream is torn down and reopened.
   * Pass the authenticated user id so the stream reconnects on login/logout.
   *
   * Note: we intentionally do NOT gate opening on a React `isAuthenticated`
   * flag. The container is mounted at the app root, where that flag is `false`
   * on the first render even for a logged-in user (its `useCurrentUser` query
   * has not resolved yet). The session cookie is the source of truth: the
   * EventSource carries it, so it authenticates on its own when logged in, and
   * the server returns 401 (EventSource then does not reconnect) when not.
   */
  reconnectKey?: string | number | null;
}

/**
 * Subscribes to the server-sent notification stream (`/api/notifications/stream`)
 * for the current user. On each new notification it refetches the notifications
 * list + unread count (so the bell stays correct even with no push subscription)
 * and hands the notification to `onNotification` for the in-app banner.
 *
 * This is the push-independent delivery path: it works whenever the app is open,
 * regardless of browser notification permission. Mount once at the app root.
 */
export function useNotificationStream({
  onNotification,
  reconnectKey,
}: UseNotificationStreamOptions): void {
  const queryClient = useQueryClient();
  const onNotificationRef = useRef(onNotification);
  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    if (typeof globalThis.EventSource === "undefined") return;

    const source = new EventSource("/api/notifications/stream", {
      withCredentials: true,
    });

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as
          | { connected?: boolean }
          | StreamNotification;
        if ((data as { connected?: boolean }).connected) return; // handshake
        const notification = data as StreamNotification;
        if (typeof notification.id !== "number") return;

        // Keep the bell + notifications list in sync without a push round-trip.
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.all,
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });

        onNotificationRef.current(notification);
      } catch {
        // malformed event — ignore
      }
    };

    return () => source.close();
  }, [reconnectKey, queryClient]);
}
