import { sw } from "./sw";
import { CACHE_VERSION } from "./constants";

// Activate event handler - clean up old caches
export function handleActivate(event: ExtendableEvent): void {
  event.waitUntil(
    Promise.all([
      // Take control of all clients immediately
      sw.clients.claim(),
      // Clean up old caches if needed
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Keep current CACHE_VERSION cache only
            // Delete old API caches since we don't use them anymore
            if (cacheName !== CACHE_VERSION) {
              console.log(`Deleting old cache: ${cacheName}`);
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          }),
        );
      }),
    ]).then(() => {
      console.log("Rawkoon service worker activated");
    }),
  );
}
