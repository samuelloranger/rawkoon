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
  hasCachedBookFile,
  isBookContentRequest,
  isBookMetaRequest,
  isBuildAsset,
  precacheShell,
  seedCachedBookFiles,
} from "./book-cache";

import { sw } from "./sw";

// Learn which books are stored as soon as the worker starts, not just on
// activation: a killed worker restarts without firing `activate`, and one that
// has forgotten its cache would send a downloaded book to the network.
void seedCachedBookFiles();

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
  // Only claim bytes this worker actually holds. Answering a stream it has no
  // copy of replaces the browser's native, resumable range fetching with JS in
  // a worker iOS kills aggressively while the screen is locked — which is how a
  // dropped request became a mid-chapter MEDIA_ERR_NETWORK.
  if (isBookContentRequest(url) && hasCachedBookFile(url)) {
    handleBookFetch(event);
  } else if (isBookMetaRequest(url)) {
    handleBookMetaFetch(event);
  } else if (event.request.mode === "navigate" || isBuildAsset(url)) {
    handleShellFetch(event);
  }
});
