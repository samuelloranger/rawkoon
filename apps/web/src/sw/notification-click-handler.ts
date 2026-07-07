import { sw } from "./sw";
import { normalizeNotificationUrl } from "@rawkoon/shared/utils/notifications";
import type { NotificationData } from "./types";

// Handle notification click events - navigate to URL or handle actions
export function handleNotificationClick(event: NotificationEvent): void {
  event.notification.close();

  const action = event.action;
  const notificationData = (event.notification.data || {}) as NotificationData;

  // Handle "reload" action for update notifications
  if (action === "reload" || notificationData.action === "reload") {
    event.waitUntil(
      sw.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => {
          // Reload all open windows
          clients.forEach((client) => {
            if (client.url && "navigate" in client) {
              client.navigate(client.url);
            }
          });
          // Also reload the service worker
          return sw.registration.update().then(() => {
            // Force reload after a short delay
            return new Promise<void>((resolve) => {
              setTimeout(() => {
                clients.forEach((client) => {
                  if (client.url && "navigate" in client) {
                    client.navigate(client.url);
                  }
                });
                resolve();
              }, 100);
            });
          });
        }),
    );
    return;
  }

  // Handle "dismiss" action for update notifications
  if (action === "dismiss" && notificationData.action === "reload") {
    return; // Just close the notification
  }

  // Handle "close" action
  if (action === "close") {
    return;
  }

  // Default: navigate to URL (for "open" action or notification click)
  const url = normalizeNotificationUrl(notificationData.url) || "/";

  event.waitUntil(
    sw.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const destination = new URL(url, self.location.origin).toString();

        for (const client of clients) {
          if (!("focus" in client) || !("navigate" in client)) {
            continue;
          }

          const currentUrl = new URL(client.url);
          const targetUrl = new URL(destination);

          if (
            currentUrl.pathname === targetUrl.pathname &&
            currentUrl.search === targetUrl.search &&
            currentUrl.hash === targetUrl.hash
          ) {
            await client.focus();
            return;
          }
        }

        for (const client of clients) {
          if ("focus" in client && "navigate" in client) {
            await client.focus();
            await client.navigate(destination);
            return;
          }
        }

        if ("openWindow" in sw.clients) {
          await sw.clients.openWindow(destination);
        }
      }),
  );
}
