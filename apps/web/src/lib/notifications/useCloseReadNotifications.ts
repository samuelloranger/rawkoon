import { useEffect } from "react";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints/notifications";
import type { NotificationData } from "@/sw/types";

/**
 * When the tab becomes visible, close any OS-level notifications that have
 * already been read (e.g. dismissed on iOS). One fetch on focus, regardless
 * of how many notifications are shown.
 */
export function useCloseReadNotifications(): void {
  useEffect(() => {
    const closeReadNotifications = async () => {
      if (!("serviceWorker" in navigator)) return;

      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;

      const shown = await registration.getNotifications();
      if (shown.length === 0) return;

      const ids = shown
        .map((n) => (n.data as NotificationData | null)?.notification_id)
        .filter((id): id is number => typeof id === "number");

      if (ids.length === 0) return;

      try {
        const res = await fetch(NOTIFICATION_ENDPOINTS.UNREAD_IDS, {
          credentials: "include",
        });
        if (!res.ok) return;

        const { ids: unreadIds } = (await res.json()) as { ids: number[] };
        const unreadSet = new Set(unreadIds);

        for (const notification of shown) {
          const id = (notification.data as NotificationData | null)
            ?.notification_id;
          if (typeof id === "number" && !unreadSet.has(id)) {
            notification.close();
          }
        }
      } catch {
        // Offline or unauthenticated — leave notifications as-is
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void closeReadNotifications();
      }
    };

    if (document.visibilityState === "visible") {
      void closeReadNotifications();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}
