// Push + badge only — no fetch listener, no asset caching.

import { handleInstall } from "./install-handler";
import { handleMessage } from "./message-handlers";
import { handleActivate } from "./activate-handler";
import { handleSync } from "./sync-handler";
import { handlePush } from "./push-handler";
import { handleNotificationClick } from "./notification-click-handler";
import { handleNotificationClose } from "./notification-close-handler";

import { sw } from "./sw";

sw.addEventListener("install", handleInstall);
sw.addEventListener("message", handleMessage);
sw.addEventListener("activate", handleActivate);
sw.addEventListener("sync", handleSync);
sw.addEventListener("push", handlePush);
sw.addEventListener("notificationclick", handleNotificationClick);
sw.addEventListener("notificationclose", handleNotificationClose);
