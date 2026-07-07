import { EventEmitter } from "node:events";

export interface LibraryUpdateEvent {
  mediaId: number;
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
