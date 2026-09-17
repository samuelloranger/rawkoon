import { EventEmitter } from "node:events";
import type { DownloadProgressItem } from "@rawkoon/shared/types";

export interface LibraryUpdateEvent {
  mediaId: number;
  ts: number;
}

export interface BookUpdateEvent {
  bookId: number;
  ts: number;
}

export interface DownloadProgressUpdateEvent {
  mediaId: number;
  downloads: DownloadProgressItem[];
  ts: number;
}

/** In-process pub/sub for library state changes. SSE clients subscribe here. */
export const libraryEventBus = new EventEmitter();
libraryEventBus.setMaxListeners(200);

export function emitLibraryUpdate(mediaId: number): void {
  libraryEventBus.emit("update", {
    mediaId,
    ts: Date.now(),
  } satisfies LibraryUpdateEvent);
}

/**
 * Books ride the same bus under their own event name, so one SSE connection
 * serves both domains. Emitted whenever an edition's state changes server-side:
 * a grab, an import, or a failed download reverting to wanted.
 */
export function emitBookUpdate(bookId: number): void {
  libraryEventBus.emit("book-update", {
    bookId,
    ts: Date.now(),
  } satisfies BookUpdateEvent);
}

/**
 * Live download progress, pushed on the same bus so the one library-events SSE
 * connection carries it too. Unlike the invalidation events above, this fires
 * repeatedly while a download runs and carries the numbers directly, so a
 * client never has to refetch to move the progress bar.
 */
export function emitDownloadProgress(
  mediaId: number,
  downloads: DownloadProgressItem[],
): void {
  libraryEventBus.emit("download-progress", {
    mediaId,
    downloads,
    ts: Date.now(),
  } satisfies DownloadProgressUpdateEvent);
}
