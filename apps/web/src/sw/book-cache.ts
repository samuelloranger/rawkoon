import { parseByteRange } from "@rawkoon/shared/utils";
import { sw } from "./sw";
import { CACHE_VERSION } from "./constants";

const SHELL_URL = "/index.html";

/**
 * Offline books.
 *
 * One cache entry per `/api/books/files/:id/content` response — the endpoint is
 * immutable and ETagged, so storing the response as-is is enough and the
 * request never needs revalidating. Eviction is explicit: silently dropping the
 * book someone took on a plane is worse than a quota error.
 */
export const BOOK_CACHE = "rawkoon-books";

const BOOK_CONTENT = /\/api\/books\/files\/(\d+)\/content$/;

/**
 * The requests a downloaded book needs in order to be *reopened* offline: the
 * book itself and its edition manifest, which is where the reader learns the
 * content url of the bytes already stored. Caching bytes alone leaves a book
 * that cannot be found after a reload.
 */
const BOOK_META = [
  /^\/api\/books\/\d+$/,
  /^\/api\/books\/editions\/\d+\/manifest$/,
];

const pathOf = (url: string): string =>
  new URL(url, sw.location.origin).pathname;

export const isBookContentRequest = (url: string): boolean =>
  BOOK_CONTENT.test(pathOf(url));

export const isBookMetaRequest = (url: string): boolean => {
  const path = pathOf(url);
  return BOOK_META.some((pattern) => pattern.test(path));
};

/** Hashed build assets: immutable by name, so cache-first is always correct. */
export const isBuildAsset = (url: string): boolean => {
  const target = new URL(url, sw.location.origin);
  return (
    target.origin === sw.location.origin &&
    target.pathname.startsWith("/assets/")
  );
};

const post = (client: Client | null, message: unknown) => {
  (client as WindowClient | null)?.postMessage(message);
};

/**
 * Downloads a file into the cache, reporting real progress.
 *
 * The body is piped straight into Cache Storage through a counting transform
 * rather than accumulated and wrapped in a Blob: a 700MB audiobook held in
 * memory is exactly the pressure that gets a service worker killed, and the
 * download would fail with quota to spare. `Content-Length` is present because
 * the route sets it, so progress is a real percentage.
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
    let received = 0;
    let lastReported = 0;

    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        // Whole percents only: a large file would otherwise post thousands of
        // messages at one per chunk.
        const percent = total > 0 ? Math.floor((received / total) * 100) : 0;
        if (percent > lastReported) {
          lastReported = percent;
          post(client, { type: "bookCacheProgress", fileId, percent });
        }
        controller.enqueue(chunk);
      },
    });

    const cache = await caches.open(BOOK_CACHE);
    await cache.put(
      url,
      new Response(response.body.pipeThrough(counter), {
        status: 200,
        headers: response.headers,
      }),
    );
    post(client, { type: "bookCacheDone", fileId });
  } catch (error) {
    // A quota failure or an interrupted stream must leave nothing behind, or the
    // reader would open a truncated file.
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

/**
 * Stores the book and manifest responses for an edition, so a downloaded book
 * can still be found after a reload with no network. Called when a download
 * finishes; failures are ignored, since the bytes are the part that matters and
 * a later online visit refreshes the metadata anyway.
 */
export const cacheBookMeta = async (
  bookId: number,
  editionId: number,
): Promise<void> => {
  const cache = await caches.open(BOOK_CACHE);
  await Promise.all(
    [`/api/books/${bookId}`, `/api/books/editions/${editionId}/manifest`].map(
      async (url) => {
        try {
          const response = await fetch(url, { credentials: "include" });
          if (response.ok) await cache.put(url, response);
        } catch {
          // Offline or a transient failure: nothing to recover here.
        }
      },
    ),
  );
};

/**
 * Cache-first for book bytes: a downloaded book must open with no network.
 *
 * A media element does not fetch audio whole — it probes with `Range:
 * bytes=0-1` and then seeks by range. Returning the stored `200` to those
 * requests is why a downloaded audiobook could refuse to start or seek in the
 * iOS PWA: WebKit requires a real `206` with `Content-Range` from a service
 * worker serving media. So the worker answers ranges itself, with the same
 * parser the origin route uses.
 */
export const handleBookFetch = (event: FetchEvent): void => {
  event.respondWith(serveBookBytes(event.request));
};

const withRangeSupport = (response: Response): Response => {
  const headers = new Headers(response.headers);
  // Without this the element assumes it cannot seek at all.
  headers.set("Accept-Ranges", "bytes");
  return new Response(response.body, {
    status: 200,
    statusText: "OK",
    headers,
  });
};

const serveBookBytes = async (request: Request): Promise<Response> => {
  const cache = await caches.open(BOOK_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (!cached) return fetch(request);

  const header = request.headers.get("range");
  if (!header) return withRangeSupport(cached);

  // A Blob from Cache Storage is a handle to the stored bytes, and `slice` is
  // a view on it — neither pulls the whole audiobook into memory the way
  // buffering an ArrayBuffer would.
  const blob = await cached.blob();
  const range = parseByteRange(header, blob.size);

  if (range === null) return withRangeSupport(cached);

  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      statusText: "Range Not Satisfiable",
      headers: {
        "Content-Range": `bytes */${blob.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const headers = new Headers(cached.headers);
  headers.set(
    "Content-Range",
    `bytes ${range.start}-${range.end}/${blob.size}`,
  );
  headers.set("Content-Length", String(range.end - range.start + 1));
  headers.set("Accept-Ranges", "bytes");
  return new Response(blob.slice(range.start, range.end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
};

/**
 * Network-first for the book and manifest requests, falling back to the stored
 * copy. Fresh metadata wins whenever there is a network — a newly imported file
 * has to show up — and the cached copy is what lets a downloaded book open at
 * all when there is none.
 */
export const handleBookMetaFetch = (event: FetchEvent): void => {
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(BOOK_CACHE);
          await cache.put(event.request, response.clone());
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(BOOK_CACHE);
        const cached = await cache.match(event.request, { ignoreVary: true });
        if (cached) return cached;
        return new Response(JSON.stringify({ error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }),
  );
};

/**
 * Cache-first for hashed build assets, and a cached shell for navigations.
 * Without these, a reload while offline never gets far enough to ask for a
 * book: the document and its JS would both fail at the network.
 */
export const handleShellFetch = (event: FetchEvent): void => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        const shell = await cache.match(SHELL_URL);
        return (
          shell ??
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          })
        );
      }),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      // Asset names carry a content hash, so a stored copy never goes stale;
      // old ones leave with their CACHE_VERSION on the next activation.
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }),
  );
};

/** Stores the app shell so a navigation can be answered offline. */
export const precacheShell = async (): Promise<void> => {
  try {
    const cache = await caches.open(CACHE_VERSION);
    const response = await fetch(SHELL_URL, { cache: "reload" });
    if (response.ok) await cache.put(SHELL_URL, response);
  } catch {
    // A failed precache costs offline navigation, not this activation.
  }
};
