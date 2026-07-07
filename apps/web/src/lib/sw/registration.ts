export function syncBadge(): void {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.active) {
        registration.active.postMessage({ type: "syncBadge" });
      }
    });
  }
}

/**
 * Clear badge count by sending a message to the service worker
 */
export function clearBadge(): void {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.active) {
        registration.active.postMessage({ type: "clearBadge" });
      }
    });
  }
}

/**
 * Show notification when update is available
 */
function showUpdateAvailableNotification(): void {
  // Send message to service worker to show update notification
  navigator.serviceWorker.ready.then((registration) => {
    if (registration.active) {
      registration.active.postMessage({ type: "showUpdateNotification" });
    }
  });
}

/**
 * Register the service worker and set up badge clearing, syncing, and update notifications
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  // Register service worker on window load
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log(
          "Service Worker registered for push notifications:",
          registration.scope,
        );

        // Sync badge when app loads
        syncBadge();

        // Listen for service worker updates
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // New version available - notify user
                showUpdateAvailableNotification();
              }
            });
          }
        });

        // Check for updates periodically (every hour)
        setInterval(
          () => {
            registration.update();
          },
          60 * 60 * 1000,
        );

        // In development, check for updates more frequently
        if (import.meta.env.DEV) {
          // Check for updates every 30 seconds in dev
          setInterval(() => {
            registration.update();
          }, 30000);
        }
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
  });

  // Sync badge when app gains focus (user switches back to the app)
  window.addEventListener("focus", () => {
    syncBadge();
  });

  // Sync badge when app comes back online
  window.addEventListener("online", () => {
    syncBadge();
  });
}
