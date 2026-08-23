// Service worker for Rawkoon - Push notifications and background sync

import { handleInstall } from "./install-handler";
import { handleMessage } from "./message-handlers";
import { handleActivate } from "./activate-handler";
import { handleSync } from "./sync-handler";
import { handlePush } from "./push-handler";
import { handleNotificationClick } from "./notification-click-handler";
import { handleNotificationClose } from "./notification-close-handler";

import { sw } from "./sw";

// Install event - minimal setup
sw.addEventListener("install", handleInstall);

// Message event - handle messages from clients (e.g., when app opens)
sw.addEventListener("message", handleMessage);

// Activate event - clean up old caches
sw.addEventListener("activate", handleActivate);

// Periodic background sync - sync notification count
sw.addEventListener("sync", handleSync);

// Push event - handle incoming push notifications
sw.addEventListener("push", handlePush);

// Notification click event - navigate to URL or handle actions
sw.addEventListener("notificationclick", handleNotificationClick);

// Notification close event - track when notifications are dismissed
sw.addEventListener("notificationclose", handleNotificationClose);
