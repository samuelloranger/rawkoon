import type { SyncEvent } from "./types";
import { syncBadgeCount } from "./badge";
import { flushBookProgress } from "./book-progress-sync";

// Periodic background sync handler - sync notification count
export function handleSync(event: Event): void {
  const syncEvent = event as SyncEvent;

  if (syncEvent.tag === "sync-notifications") {
    syncEvent.waitUntil(syncBadgeCount());
  }

  // Reading positions queued while offline.
  if (syncEvent.tag === "book-progress") {
    syncEvent.waitUntil(flushBookProgress());
  }
}
