import type { BookProgressWrite } from "@rawkoon/shared/types";

/**
 * Offline queue for reading positions.
 *
 * A write that fails goes here and is replayed on reconnect. Replay is safe in
 * any order because the server keeps the newest `client_updated_at` and
 * discards the rest, so a week-old queue cannot rewind a position set since.
 *
 * The queue is keyed by edition, which makes every write a read-modify-write:
 * two failing saves race, and the loser must not be the newer one. Every
 * mutation here therefore compares `client_updated_at` inside the same
 * transaction it writes in, and flushes are serialised so a delete can never
 * remove a position that arrived while a request was in flight.
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

/**
 * Runs several requests inside ONE transaction, which is what makes a
 * read-then-write atomic against another tab or the service worker.
 */
const atomic = async <T>(
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const result = await run(store);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    db.close();
  }
};

const ask = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const stamp = (body: BookProgressWrite | undefined): number => {
  const value = body?.client_updated_at;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const queueProgress = async (
  editionId: number,
  body: BookProgressWrite,
): Promise<void> => {
  try {
    await atomic(async (store) => {
      const existing = await ask<QueuedProgress | undefined>(
        store.get(editionId),
      );
      // Requests fail out of order: an older save rejecting after a newer one
      // must not overwrite the newer position with a rewind.
      if (stamp(existing?.body) > stamp(body)) return;
      store.put({ editionId, body });
    });
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

/**
 * Drops a queued entry only while it is still the one that was sent.
 *
 * An unconditional delete by edition threw away a newer position that was
 * queued while the request was in flight.
 */
const clearQueued = async (
  editionId: number,
  sentAt: number,
): Promise<void> => {
  try {
    await atomic(async (store) => {
      const existing = await ask<QueuedProgress | undefined>(
        store.get(editionId),
      );
      if (!existing || stamp(existing.body) > sentAt) return;
      store.delete(editionId);
    });
  } catch {
    // Nothing to recover: a stale entry replays harmlessly next time.
  }
};

/** The newest queued position for an edition, if the queue holds one. */
export const peekQueuedProgress = async (
  editionId: number,
): Promise<BookProgressWrite | null> => {
  try {
    const entry = await tx<QueuedProgress | undefined>("readonly", (store) =>
      store.get(editionId),
    );
    return entry?.body ?? null;
  } catch {
    return null;
  }
};

/**
 * Ask the service worker to flush the queue when connectivity returns. Falls
 * back to an immediate flush where Background Sync is unavailable (Safari).
 */
const requestSync = async (): Promise<void> => {
  // Hoisted: an inline `in` check narrows Navigator to `never` in this branch.
  const hasServiceWorker = "serviceWorker" in navigator;
  if (!hasServiceWorker) {
    if (navigator.onLine) await flushQueue();
    return;
  }
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

/** Serialises flushes: two in parallel can delete each other's work. */
let inFlight: Promise<number> | null = null;

/** Replay every queued position. Entries that still fail stay queued. */
export const flushQueue = async (): Promise<number> => {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const queued = await readQueue();
    let flushed = 0;
    for (const entry of queued) {
      const sentAt = stamp(entry.body);
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
        // forever; only a network or server failure keeps its place in the
        // queue.
        if (res.ok || (res.status >= 400 && res.status < 500)) {
          await clearQueued(entry.editionId, sentAt);
          flushed++;
        }
      } catch {
        break;
      }
    }
    return flushed;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
};

/**
 * Flush on every occasion connectivity might have come back.
 *
 * Safari has no Background Sync, so nothing replayed the queue there: a
 * position saved while offline sat in IndexedDB until the next save happened
 * to succeed, and closing the app lost it for good.
 */
export const startProgressQueueFlusher = (): (() => void) => {
  const attempt = () => {
    if (navigator.onLine) void flushQueue();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") attempt();
  };

  window.addEventListener("online", attempt);
  window.addEventListener("focus", attempt);
  document.addEventListener("visibilitychange", onVisible);
  attempt();

  return () => {
    window.removeEventListener("online", attempt);
    window.removeEventListener("focus", attempt);
    document.removeEventListener("visibilitychange", onVisible);
  };
};
