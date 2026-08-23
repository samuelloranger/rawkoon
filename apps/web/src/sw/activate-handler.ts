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
            // Keep only the current CACHE_VERSION cache. Everything else is
            // stale — including "rawkoon-books", the offline store of the
            // removed in-app player, which this drops on the first activation
            // after the upgrade.
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
