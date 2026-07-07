import type { SyncEvent } from "./types";
import { syncBadgeCount } from "./badge";

// Periodic background sync handler - sync notification count
export function handleSync(event: Event): void {
  const syncEvent = event as SyncEvent;

  if (syncEvent.tag === "sync-notifications") {
    syncEvent.waitUntil(syncBadgeCount());
  }
}
