import { sw } from "./sw";
import { CACHE_VERSION } from "./constants";
import { BOOK_CACHE } from "./book-cache";

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
            // Keep the current CACHE_VERSION cache, and the book cache, which
            // holds files a user explicitly downloaded: eviction there is the
            // user's decision, so an app release must not wipe it.
            // Delete old API caches since we don't use them anymore
            if (cacheName !== CACHE_VERSION && cacheName !== BOOK_CACHE) {
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
