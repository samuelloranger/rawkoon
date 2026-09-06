import { sw } from "./sw";

export function handleActivate(event: ExtendableEvent): void {
  event.waitUntil(
    Promise.all([
      sw.clients.claim(),
      // Drop leftover caches from older workers that used to store assets.
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))),
        ),
    ]).then(() => {
      console.log("Rawkoon service worker activated");
    }),
  );
}
