import { sw } from "./sw";
import { normalizeNotificationUrl } from "@rawkoon/shared/utils/notifications";
import { handleAppUpdate } from "./app-update";
import { syncBadgeCount } from "./badge";
import type { PushNotificationData } from "./types";

export function handlePush(event: PushEvent): void {
  let data: PushNotificationData = {};

  if (event.data) {
    try {
      data = event.data.json() as PushNotificationData;
    } catch {
      data = { title: "Rawkoon", body: event.data.text() };
    }
  }

  // The in-app banner is delivered separately over SSE (works without a push
  // subscription). The service worker is responsible only for the OS-level
  // notification + badge when a push arrives.
  const title = data.title || "Rawkoon";
  const body = data.body || "Vous avez une nouvelle notification";
  const icon = data.icon || "/icon-192.png";
  const badge = data.badge || "/icon-32.png";
  const tag = data.tag || "notification";
  const url = normalizeNotificationUrl(data.data?.url) || "/";

  // `image` is a valid Notifications API option (a large hero image, e.g. a
  // poster) but is absent from lib.dom's NotificationOptions, so widen locally.
  const options: NotificationOptions & { image?: string } = {
    body,
    icon,
    badge,
    tag,
    vibrate: data.vibrate || [200, 100, 200],
    data: {
      url,
      notification_type: data.data?.notification_type || null,
    },
    requireInteraction: true,
  };

  if (data.image) options.image = data.image;

  if (data.actions && Array.isArray(data.actions) && data.actions.length > 0) {
    options.actions = data.actions;
  } else {
    options.actions = [
      { action: "open", title: "Ouvrir" },
      { action: "close", title: "Fermer" },
    ];
  }

  const promises: Promise<unknown>[] = [
    sw.registration.showNotification(title, options),
    syncBadgeCount(),
  ];

  if (data.data?.notification_type === "app-update") {
    promises.push(handleAppUpdate());
  }

  event.waitUntil(Promise.all(promises));
}
