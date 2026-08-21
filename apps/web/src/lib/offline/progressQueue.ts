import type { BookProgressWrite } from "@rawkoon/shared/types";

/**
 * Offline queue for reading positions.
 *
 * A write that fails goes here and is replayed on reconnect. Replay is safe in
 * any order because the server keeps the newest `client_updated_at` and
 * discards the rest, so a week-old queue cannot rewind a position set since.
 */
const DB_NAME = "rawkoon-books";
const STORE = "bookProgressQueue";
const DB_VERSION = 1;

interface QueuedProgress {
  editionId: number;
  body: BookProgressWrite;
}

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by edition: only the latest queued position per edition
        // matters, so a long offline session cannot grow without bound.
        db.createObjectStore(STORE, { keyPath: "editionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const tx = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
};

export const queueProgress = async (
  editionId: number,
  body: BookProgressWrite,
): Promise<void> => {
  try {
    await tx("readwrite", (store) => store.put({ editionId, body }));
    await requestSync();
  } catch {
    // A blocked or unavailable IndexedDB is not worth failing a read over.
  }
};

const readQueue = async (): Promise<QueuedProgress[]> => {
  try {
    return await tx<QueuedProgress[]>("readonly", (store) => store.getAll());
  } catch {
    return [];
  }
};

const clearQueued = async (editionId: number): Promise<void> => {
  try {
    await tx("readwrite", (store) => store.delete(editionId));
  } catch {
    // Nothing to recover: a stale entry replays harmlessly next time.
  }
};

/**
 * Ask the service worker to flush the queue when connectivity returns. Falls
 * back to an immediate flush where Background Sync is unavailable (Safari).
 */
const requestSync = async (): Promise<void> => {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const sync = (
    registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    }
  ).sync;
  if (sync) {
    await sync.register("book-progress");
    return;
  }
  if (navigator.onLine) await flushQueue();
};

/** Replay every queued position. Entries that still fail stay queued. */
const flushQueue = async (): Promise<number> => {
  const queued = await readQueue();
  let flushed = 0;
  for (const entry of queued) {
    try {
      const res = await fetch(
        `/api/books/editions/${entry.editionId}/progress`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(entry.body),
        },
      );
      // A 4xx will never succeed on retry, so drop it rather than replay it
      // forever; only a network or server failure keeps its place in the queue.
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await clearQueued(entry.editionId);
        flushed++;
      }
    } catch {
      break;
    }
  }
  return flushed;
};
