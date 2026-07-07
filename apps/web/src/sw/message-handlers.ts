import { sw } from "./sw";
import { syncBadgeCount } from "./badge";
import type { MessageData } from "./types";

// Handle messages from clients (e.g., when app opens)
export function handleMessage(event: ExtendableMessageEvent): void {
  const data = event.data as MessageData | null;

  if (data && data.type === "clearBadge") {
    // Clear the app badge when the app is opened
    if ("clearAppBadge" in navigator && navigator.clearAppBadge) {
      navigator.clearAppBadge().catch((err) => {
        console.error("Error clearing app badge:", err);
      });
    }
  }

  // Sync badge count from server
  if (data && data.type === "syncBadge") {
    syncBadgeCount();
  }

  // Show update notification
  if (data && data.type === "showUpdateNotification") {
    sw.registration.showNotification("Rawkoon - Mise à jour disponible", {
      body: "Une nouvelle version est disponible. Cliquez pour recharger.",
      icon: "/icon-192.png",
      badge: "/icon-32.png",
      tag: "update-available",
      requireInteraction: true,
      data: {
        url: "/",
        action: "reload",
      },
      actions: [
        {
          action: "reload",
          title: "Reload Now",
        },
        {
          action: "dismiss",
          title: "Later",
        },
      ],
    });
  }

  // Clear all caches (preserves service worker registration and push subscriptions)
  if (data && data.type === "clearCache") {
    event.waitUntil(
      caches
        .keys()
        .then((cacheNames) => {
          return Promise.all(
            cacheNames.map((cacheName) => {
              console.log(`Service worker clearing cache: ${cacheName}`);
              return caches.delete(cacheName);
            }),
          );
        })
        .then(() => {
          console.log("Service worker caches cleared");
        })
        .catch((error) => {
          console.error("Error clearing caches in service worker:", error);
        }),
    );
  }
}
