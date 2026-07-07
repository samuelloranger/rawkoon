import { sw } from "./sw";

// Install event handler - minimal setup
export function handleInstall(event: ExtendableEvent): void {
  // Skip waiting to activate immediately
  sw.skipWaiting();
  event.waitUntil(
    Promise.resolve().then(() => {
      console.log("Rawkoon service worker installed (push notifications only)");
    }),
  );
}
