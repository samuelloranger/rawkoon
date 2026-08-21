import { sw } from "./sw";

/**
 * Offline books.
 *
 * One cache entry per `/api/books/files/:id/content` response — the endpoint is
 * immutable and ETagged, so storing the response as-is is enough and the
 * request never needs revalidating. Eviction is explicit: silently dropping the
 * book someone took on a plane is worse than a quota error.
 */
const BOOK_CACHE = "rawkoon-books";

const BOOK_CONTENT = /\/api\/books\/files\/(\d+)\/content$/;

export const isBookContentRequest = (url: string): boolean =>
  BOOK_CONTENT.test(new URL(url, sw.location.origin).pathname);

const post = (client: Client | null, message: unknown) => {
  (client as WindowClient | null)?.postMessage(message);
};

/**
 * Downloads a file into the cache, reporting real progress. `Content-Length`
 * is present on these responses because the route sets it, so the page can show
 * a percentage instead of a spinner.
 */
export const cacheBookFile = async (
  fileId: number,
  client: Client | null,
): Promise<void> => {
  const url = `/api/books/files/${fileId}/content`;
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const total = Number(response.headers.get("content-length") ?? 0);
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    let lastReported = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      // Report on whole percents: a 700MB file would otherwise post thousands
      // of messages.
      const percent = total > 0 ? Math.floor((received / total) * 100) : 0;
      if (percent > lastReported) {
        lastReported = percent;
        post(client, { type: "bookCacheProgress", fileId, percent });
      }
    }

    const cache = await caches.open(BOOK_CACHE);
    await cache.put(
      url,
      new Response(new Blob(chunks), { headers: response.headers }),
    );
    post(client, { type: "bookCacheDone", fileId });
  } catch (error) {
    // A quota failure must leave nothing half-cached, or the reader would open
    // a truncated file.
    await (await caches.open(BOOK_CACHE)).delete(url);
    post(client, {
      type: "bookCacheFailed",
      fileId,
      reason:
        error instanceof DOMException && error.name === "QuotaExceededError"
          ? "quota"
          : "network",
    });
  }
};

export const evictBookFile = async (
  fileId: number,
  client: Client | null,
): Promise<void> => {
  const cache = await caches.open(BOOK_CACHE);
  await cache.delete(`/api/books/files/${fileId}/content`);
  post(client, { type: "bookCacheEvicted", fileId });
};

/** Which files are cached, and how much space they take. */
export const bookCacheStatus = async (client: Client | null): Promise<void> => {
  const cache = await caches.open(BOOK_CACHE);
  const entries: Array<{ fileId: number; sizeBytes: number }> = [];
  for (const request of await cache.keys()) {
    const match = BOOK_CONTENT.exec(new URL(request.url).pathname);
    if (!match) continue;
    const response = await cache.match(request);
    const size = Number(response?.headers.get("content-length") ?? 0);
    entries.push({ fileId: Number(match[1]), sizeBytes: size });
  }
  post(client, { type: "bookCacheStatus", entries });
};

/** Cache-first for book bytes: a downloaded book must open with no network. */
export const handleBookFetch = (event: FetchEvent): void => {
  event.respondWith(
    caches
      .open(BOOK_CACHE)
      .then((cache) => cache.match(event.request, { ignoreVary: true }))
      .then((cached) => cached ?? fetch(event.request)),
  );
};
