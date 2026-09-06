import { syncBadgeCount } from "./badge";
import { setSwStrings } from "./strings";
import type { MessageData } from "./types";

export function handleMessage(event: ExtendableMessageEvent): void {
  const data = event.data as MessageData | null;

  if (data && data.type === "clearBadge") {
    if ("clearAppBadge" in navigator && navigator.clearAppBadge) {
      navigator.clearAppBadge().catch((err) => {
        console.error("Error clearing app badge:", err);
      });
    }
  }

  if (data && data.type === "syncBadge") {
    syncBadgeCount();
  }

  if (data && data.type === "setStrings" && data.strings) {
    setSwStrings(data.strings);
  }

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
