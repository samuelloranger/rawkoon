// Service worker for Rawkoon - Push notifications and background sync

import { handleInstall } from "./install-handler";
import { handleMessage } from "./message-handlers";
import { handleActivate } from "./activate-handler";
import { handleSync } from "./sync-handler";
import { handlePush } from "./push-handler";
import { handleNotificationClick } from "./notification-click-handler";
import { handleNotificationClose } from "./notification-close-handler";

import {
  handleBookFetch,
  handleBookMetaFetch,
  handleShellFetch,
  isBookContentRequest,
  isBookMetaRequest,
  isBuildAsset,
  precacheShell,
} from "./book-cache";

import { sw } from "./sw";

// Install event - minimal setup
sw.addEventListener("install", handleInstall);

// Message event - handle messages from clients (e.g., when app opens)
sw.addEventListener("message", handleMessage);

// Activate event - clean up old caches
sw.addEventListener("activate", handleActivate);

// Store the shell on activation, so an offline navigation has something to
// answer with on the next visit.
sw.addEventListener("activate", (event) => {
  (event as ExtendableEvent).waitUntil(precacheShell());
});

// Periodic background sync - sync notification count
sw.addEventListener("sync", handleSync);

// Push event - handle incoming push notifications
sw.addEventListener("push", handlePush);

// Notification click event - navigate to URL or handle actions
sw.addEventListener("notificationclick", handleNotificationClick);

// Notification close event - track when notifications are dismissed
sw.addEventListener("notificationclose", handleNotificationClose);

// Fetch event - everything a downloaded book needs to open with no network:
// its bytes, the metadata that locates them, and a shell to boot the app.
// Every other request goes to the network untouched.
sw.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;
  if (isBookContentRequest(url)) {
    handleBookFetch(event);
  } else if (isBookMetaRequest(url)) {
    handleBookMetaFetch(event);
  } else if (event.request.mode === "navigate" || isBuildAsset(url)) {
    handleShellFetch(event);
  }
});
