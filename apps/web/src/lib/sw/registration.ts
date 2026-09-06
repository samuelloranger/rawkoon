import i18n from "@/lib/i18n";

export function syncBadge(): void {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.active) {
        registration.active.postMessage({ type: "syncBadge" });
      }
    });
  }
}

export function clearBadge(): void {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.active) {
        registration.active.postMessage({ type: "clearBadge" });
      }
    });
  }
}

function postSwStrings(): void {
  if (!("serviceWorker" in navigator)) return;
  const strings = {
    open: i18n.t("common.open"),
    close: i18n.t("common.close"),
    fallbackBody: i18n.t("notifications.pushFallback"),
  };
  void navigator.serviceWorker.ready.then((registration) => {
    registration.active?.postMessage({ type: "setStrings", strings });
  });
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log(
          "Service Worker registered for push notifications:",
          registration.scope,
        );

        syncBadge();
        postSwStrings();

        setInterval(
          () => {
            registration.update();
          },
          60 * 60 * 1000,
        );

        if (import.meta.env.DEV) {
          setInterval(() => {
            registration.update();
          }, 30000);
        }
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
  });

  window.addEventListener("focus", () => {
    syncBadge();
  });

  window.addEventListener("online", () => {
    syncBadge();
  });

  i18n.on("languageChanged", () => {
    postSwStrings();
  });
}
