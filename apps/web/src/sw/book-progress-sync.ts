/**
 * Replays reading positions queued while offline.
 *
 * Order does not matter: the server keeps the newest `client_updated_at` and
 * rejects the rest, so a week-old queue cannot rewind a position set since. A
 * 4xx is dropped rather than replayed forever; only network and server failures
 * keep their place.
 *
 * Deletes are conditional on the entry still being the one that was sent: the
 * page can queue a newer position for the same edition while a request is in
 * flight, and an unconditional delete by edition threw that newer position
 * away.
 */
const DB_NAME = "rawkoon-books";
const STORE = "bookProgressQueue";

interface QueuedProgress {
  editionId: number;
  body: Record<string, unknown>;
}

const stamp = (body: Record<string, unknown> | undefined): number => {
  const value = body?.client_updated_at;
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "editionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const flushBookProgress = async (): Promise<void> => {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return;
  }

  try {
    const queued = await new Promise<QueuedProgress[]>((resolve, reject) => {
      const request = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result as QueuedProgress[]);
      request.onerror = () => reject(request.error);
    });

    for (const entry of queued) {
      const response = await fetch(
        `/api/books/editions/${entry.editionId}/progress`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(entry.body),
        },
      );
      if (!response.ok && response.status >= 500) break;

      const sentAt = stamp(entry.body);
      await new Promise<void>((resolve) => {
        const transaction = db.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        const read = store.get(entry.editionId);
        read.onsuccess = () => {
          const current = read.result as QueuedProgress | undefined;
          // Keep a position that was queued while this request was running.
          if (current && stamp(current.body) <= sentAt) {
            store.delete(entry.editionId);
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
    }
  } catch {
    // Nothing to recover: the entries stay queued for the next sync.
  } finally {
    db.close();
  }
};
