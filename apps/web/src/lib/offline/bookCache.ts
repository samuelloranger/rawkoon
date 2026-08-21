/**
 * Page-side control of the offline book cache. The service worker owns the
 * bytes; this is the conversation with it.
 */

export interface CachedFile {
  fileId: number;
  sizeBytes: number;
}

type Progress = (percent: number) => void;

const controller = async (): Promise<ServiceWorker | null> => {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.active;
};

export const isOfflineSupported = (): boolean =>
  "serviceWorker" in navigator && "caches" in window;

/**
 * Downloads a file for offline reading, resolving when it is stored. Rejects
 * with "quota" when there is no room, which the interface states plainly rather
 * than retrying.
 */
export const downloadForOffline = async (
  fileId: number,
  onProgress?: Progress,
): Promise<void> => {
  const worker = await controller();
  if (!worker) throw new Error("unsupported");

  return new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        fileId: number;
        percent?: number;
        reason?: string;
      } | null;
      if (!data || data.fileId !== fileId) return;
      if (data.type === "bookCacheProgress") onProgress?.(data.percent ?? 0);
      if (data.type === "bookCacheDone") {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolve();
      }
      if (data.type === "bookCacheFailed") {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        reject(new Error(data.reason ?? "network"));
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    worker.postMessage({ type: "cacheBookFile", fileId });
  });
};

export const removeOffline = async (fileId: number): Promise<void> => {
  const worker = await controller();
  worker?.postMessage({ type: "evictBookFile", fileId });
};

/** What is stored, for the Downloads list in settings. */
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
