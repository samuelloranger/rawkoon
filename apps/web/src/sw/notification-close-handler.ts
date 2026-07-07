import type { NotificationData } from "./types";

// Handle notification close events - track when notifications are dismissed
export function handleNotificationClose(event: NotificationEvent): void {
  const notificationData = (event.notification.data || {}) as NotificationData;

  // Track notification dismissal (log for debugging)
  console.log("Notification dismissed:", {
    tag: event.notification.tag,
    data: notificationData,
  });

  // Don't track dismissals for update notifications
  if (notificationData.action === "reload") {
    return;
  }
}
