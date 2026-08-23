/**
 * Durable journal for audiobook transport events.
 *
 * The first attempt at diagnosing the mid-listen rewind posted each event with
 * a `keepalive` fetch from the engine's error handler. It recorded nothing,
 * which proved nothing: the event worth seeing happens exactly when the
 * connection is dead and iOS is about to freeze the page, so the report is the
 * first thing to be dropped. Silence was indistinguishable from "no event".
 *
 * So events are written to IndexedDB first — the same trick that made reading
 * positions survive a freeze — and shipped on a later launch, when there is a
 * network again. Everything here is best-effort and silent: a diagnostic must
 * never make the failure it describes worse.
 */

/** Deliberately its own database: bumping `rawkoon-books` to add a store here
 * would make the progress queue's `open(name, 1)` throw VersionError until it
 * was upgraded in lockstep, and the queue is load-bearing. */
const DB_NAME = "rawkoon-playback-journal";
const STORE = "events";
const DB_VERSION = 1;

/**
 * A phone left playing overnight through a bad connection could otherwise
 * journal without bound. Oldest entries lose; the interesting ones are the most
 * recent, because that is the session the listener is complaining about.
 */
const MAX_ENTRIES = 300;

/** Sent per flush, so one long session cannot post a single huge body. */
const BATCH_SIZE = 50;

export interface PlaybackJournalEntry {
  /** Which transport transition this was. */
  event: string;
  editionId: number;
  fileId: number | null;
  fileIndex: number | null;
  /** MediaError.code when there was one: 1 aborted, 2 network, 3 decode, 4 unsupported. */
  errorCode: number | null;
  /** The element's own clock. 0 while mid-file is the smoking gun. */
  currentTime: number | null;
  /** HTMLMediaElement.readyState — 0 means the resource was thrown away. */
  readyState: number | null;
  /** Where a load or retry aimed, when the event was one. */
  resumeOffset: number | null;
  /** Absolute position on the edition timeline, as the UI would show it. */
  position: number | null;
  retryAttempt: number | null;
  /** Why loadFile ran: open, seek, boundary, network-retry, skip-unreadable. */
  reason: string | null;
  online: boolean | null;
  visibility: string | null;
  /** Client clock, so a flushed batch can be ordered after the fact. */
  at: string;
}

interface StoredEntry extends PlaybackJournalEntry {
  id?: number;
}

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // autoIncrement, not keyed by event: every occurrence matters here, and
        // insertion order is the only ordering the reader can trust.
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const ask = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const atomic = async <T>(
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const result = await run(transaction.objectStore(STORE));
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

/** Records one transport event. Never throws. */
export const journalPlaybackEvent = async (
  entry: PlaybackJournalEntry,
): Promise<void> => {
  try {
    await atomic(async (store) => {
      store.add(entry);
      const count = await ask<number>(store.count());
      // Trim inside the same transaction that added, so two rapid events
      // cannot both skip the trim and leave the store over its cap.
      let excess = count - MAX_ENTRIES;
      if (excess <= 0) return;
      const oldest = await ask<IDBValidKey[]>(store.getAllKeys());
      for (const key of oldest) {
        if (excess-- <= 0) break;
        store.delete(key);
      }
    });
  } catch {
    // No IndexedDB (private mode, blocked storage) means no diagnostics. That
    // is strictly better than breaking playback to report on it.
  }
};

/** Everything currently journalled, oldest first. */
export const readPlaybackJournal = async (): Promise<StoredEntry[]> => {
  try {
    const db = await openDb();
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      return await ask<StoredEntry[]>(store.getAll());
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
};

const drop = async (keys: number[]): Promise<void> => {
  try {
    await atomic(async (store) => {
      for (const key of keys) store.delete(key);
    });
  } catch {
    // A stale entry is re-sent next flush; the server tolerates duplicates.
  }
};

/** Serialises flushes so two cannot post — and then delete — the same batch. */
let inFlight: Promise<number> | null = null;

/**
 * Ships journalled events. Entries are dropped only once the server has them,
 * or on a 4xx that retrying cannot fix.
 */
export const flushPlaybackJournal = async (): Promise<number> => {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const entries = await readPlaybackJournal();
    if (entries.length === 0) return 0;

    let sent = 0;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const keys = batch
        .map((entry) => entry.id)
        .filter((id): id is number => typeof id === "number");
      try {
        const res = await fetch("/api/books/playback-journal", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: batch.map(({ id: _id, ...event }) => ({
              event: event.event,
              edition_id: event.editionId,
              file_id: event.fileId,
              file_index: event.fileIndex,
              error_code: event.errorCode,
              current_time: event.currentTime,
              ready_state: event.readyState,
              resume_offset: event.resumeOffset,
              position: event.position,
              retry_attempt: event.retryAttempt,
              reason: event.reason,
              online: event.online,
              visibility: event.visibility,
              at: event.at,
            })),
          }),
        });
        if (res.ok || (res.status >= 400 && res.status < 500)) {
          await drop(keys);
          sent += batch.length;
        } else {
          break;
        }
      } catch {
        // Still offline. The batch keeps its place.
        break;
      }
    }
    return sent;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
};

/**
 * Flush whenever connectivity might be back — the same set of signals the
 * progress queue uses, and for the same reason: Safari has no Background Sync,
 * so nothing else would ever replay this.
 */
export const startPlaybackJournalFlusher = (): (() => void) => {
  const attempt = () => {
    if (navigator.onLine) void flushPlaybackJournal();
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
