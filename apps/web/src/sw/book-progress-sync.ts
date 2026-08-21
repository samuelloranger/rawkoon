/**
 * Replays reading positions queued while offline.
 *
 * Order does not matter: the server keeps the newest `client_updated_at` and
 * rejects the rest, so a week-old queue cannot rewind a position set since. A
 * 4xx is dropped rather than replayed forever; only network and server failures
 * keep their place.
 */
const DB_NAME = "rawkoon-books";
const STORE = "bookProgressQueue";

interface QueuedProgress {
  editionId: number;
  body: Record<string, unknown>;
}

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
      await new Promise<void>((resolve) => {
        const request = db
          .transaction(STORE, "readwrite")
          .objectStore(STORE)
          .delete(entry.editionId);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      });
    }
  } catch {
    // Nothing to recover: the entries stay queued for the next sync.
  } finally {
    db.close();
  }
};
