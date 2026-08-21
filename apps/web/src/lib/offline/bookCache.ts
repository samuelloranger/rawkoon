/**
 * Page-side control of the offline book cache. The service worker owns the
 * bytes; this is the conversation with it.
 */

export interface CachedFile {
  fileId: number;
  sizeBytes: number;
}

/** Overall percent across every file in the edition. */
type Progress = (percent: number) => void;

const controller = async (): Promise<ServiceWorker | null> => {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.active;
};

export const isOfflineSupported = (): boolean =>
  "serviceWorker" in navigator && "caches" in window;

/**
 * Downloads an edition for offline reading — every file, plus the metadata
 * needed to reopen it — and resolves once it is all stored. Rejects with
 * "quota" when there is no room, which the interface states plainly rather than
 * retrying.
 *
 * Progress is reported across the whole set: a two-track audiobook halfway
 * through its second file reads 75%, not 50% twice.
 */
export const downloadForOffline = async (
  target: { fileIds: number[]; bookId: number; editionId: number },
  onProgress?: Progress,
): Promise<void> => {
  const worker = await controller();
  if (!worker) throw new Error("unsupported");

  const { fileIds } = target;
  const done = new Set<number>();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (metaTimeout) window.clearTimeout(metaTimeout);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      if (err) reject(err);
      else resolve();
    };

    /**
     * Set once every file is stored, while the worker is still caching the
     * book and manifest. Resolving here would report a book as available
     * offline before it could be found again.
     */
    let metaTimeout: number | undefined;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        fileId: number;
        percent?: number;
        reason?: string;
      } | null;
      if (!data) return;

      if (data.type === "bookCacheEditionReady") {
        if (metaTimeout) window.clearTimeout(metaTimeout);
        onProgress?.(100);
        finish();
        return;
      }

      if (!fileIds.includes(data.fileId)) return;

      if (data.type === "bookCacheProgress") {
        const share = 100 / fileIds.length;
        onProgress?.(
          Math.min(
            99,
            Math.floor(done.size * share + ((data.percent ?? 0) / 100) * share),
          ),
        );
      }

      if (data.type === "bookCacheDone") {
        done.add(data.fileId);
        onProgress?.(
          Math.min(99, Math.floor((done.size / fileIds.length) * 100)),
        );
        if (done.size === fileIds.length) {
          // Metadata is next. Resolve anyway if the worker is an older build
          // that never sends the edition-level message, rather than hang.
          metaTimeout = window.setTimeout(() => finish(), 15_000);
        }
      }

      if (data.type === "bookCacheFailed") {
        finish(new Error(data.reason ?? "network"));
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    worker.postMessage({ type: "cacheBookFile", ...target });
  });
};

export const removeOffline = async (fileIds: number[]): Promise<void> => {
  const worker = await controller();
  worker?.postMessage({ type: "evictBookFile", fileIds });
};

export const listOffline = async (): Promise<CachedFile[]> => {
  const worker = await controller();
  if (!worker) return [];

  return new Promise<CachedFile[]>((resolve) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve([]);
    }, 3000);

    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        entries?: CachedFile[];
      } | null;
      if (data?.type !== "bookCacheStatus") return;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve(data.entries ?? []);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    worker.postMessage({ type: "bookCacheStatus" });
  });
};
