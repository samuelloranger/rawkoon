import { EventEmitter } from "node:events";

export interface NotificationStreamEvent {
  /** Owner of the notification — SSE connections filter on this. */
  userId: string;
  id: number;
  title: string;
  body: string;
  type: string;
  url: string | null;
  imageUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  ts: number;
}

/**
 * In-process pub/sub for freshly created notifications. The `/api/notifications/stream`
 * SSE endpoint subscribes here and relays events to the matching user's open
 * clients, so the in-app banner works even when the browser has no push
 * subscription. (API + workers share one process in prod; a Redis fan-out would
 * be the multi-process scale-out path.)
 */
export const notificationEventBus = new EventEmitter();
// One listener per open SSE connection (tabs × users); keep the ceiling high.
notificationEventBus.setMaxListeners(500);

export function emitUserNotification(
  event: Omit<NotificationStreamEvent, "ts">,
): void {
  notificationEventBus.emit("notification", {
    ...event,
    ts: Date.now(),
  } satisfies NotificationStreamEvent);
}
