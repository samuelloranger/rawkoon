import { sw } from "./sw";
import { syncBadgeCount } from "./badge";
import {
  bookCacheStatus,
  cacheBookFile,
  cacheBookMeta,
  evictBookFile,
} from "./book-cache";
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

  // Offline books: download, evict, and report what is stored. The page needs
  // real progress, so replies go back to the requesting client.
  if (data && data.type === "cacheBookFile" && data.fileIds?.length) {
    const client = event.source as Client | null;
    const { fileIds, bookId, editionId } = data;
    event.waitUntil(
      (async () => {
        // Every file, not just the first: a multi-file audiobook that stored
        // only track one would stop playing at the first boundary while still
        // claiming to be available offline.
        for (const fileId of fileIds) {
          await cacheBookFile(fileId, client);
        }
        // Then the metadata, without which the stored bytes cannot be found
        // again after a reload with no network.
        if (bookId != null && editionId != null) {
          await cacheBookMeta(bookId, editionId);
        }
      })(),
    );
  }

  if (data && data.type === "evictBookFile" && data.fileIds?.length) {
    const client = event.source as Client | null;
    const { fileIds } = data;
    event.waitUntil(
      (async () => {
        for (const fileId of fileIds) {
          await evictBookFile(fileId, client);
        }
      })(),
    );
  }

  if (data && data.type === "bookCacheStatus") {
    event.waitUntil(bookCacheStatus(event.source as Client | null));
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
