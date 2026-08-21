import { describe, it, expect, vi, beforeEach } from "vitest";

// A multi-file audiobook has to store every track before it can claim to be
// available offline, and its progress has to read as one download.

type Listener = (event: MessageEvent) => void;

let listeners: Listener[] = [];
let posted: unknown[] = [];

const emit = (data: unknown) => {
  for (const listener of [...listeners]) {
    listener({ data } as MessageEvent);
  }
};

beforeEach(() => {
  listeners = [];
  posted = [];
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready: Promise.resolve({
        active: {
          postMessage: (message: unknown) => posted.push(message),
        },
      }),
      addEventListener: (_: string, listener: Listener) =>
        listeners.push(listener),
      removeEventListener: (_: string, listener: Listener) => {
        listeners = listeners.filter((l) => l !== listener);
      },
    },
  });
  vi.stubGlobal("window", { caches: {} });
});

const { downloadForOffline, removeOffline } = await import("./bookCache");

describe("downloadForOffline", () => {
  it("asks the worker for every file and the metadata to reopen them", async () => {
    const promise = downloadForOffline({
      fileIds: [4, 5],
      bookId: 9,
      editionId: 3,
    });

    // Let the ready promise settle before the worker replies.
    await Promise.resolve();
    await Promise.resolve();

    expect(posted).toEqual([
      { type: "cacheBookFile", fileIds: [4, 5], bookId: 9, editionId: 3 },
    ]);

    emit({ type: "bookCacheDone", fileId: 4 });
    emit({ type: "bookCacheDone", fileId: 5 });
    await expect(promise).resolves.toBeUndefined();
  });

  it("does not resolve until the last file is stored", async () => {
    let settled = false;
    const promise = downloadForOffline({
      fileIds: [4, 5],
      bookId: 9,
      editionId: 3,
    }).then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    emit({ type: "bookCacheDone", fileId: 4 });
    await Promise.resolve();
    expect(settled).toBe(false);

    emit({ type: "bookCacheDone", fileId: 5 });
    await promise;
    expect(settled).toBe(true);
  });

  it("reports progress across the whole set, not per file", async () => {
    const seen: number[] = [];
    const promise = downloadForOffline(
      { fileIds: [4, 5], bookId: 9, editionId: 3 },
      (percent) => seen.push(percent),
    );

    await Promise.resolve();
    await Promise.resolve();

    emit({ type: "bookCacheProgress", fileId: 4, percent: 50 });
    emit({ type: "bookCacheDone", fileId: 4 });
    emit({ type: "bookCacheProgress", fileId: 5, percent: 50 });
    emit({ type: "bookCacheDone", fileId: 5 });
    await promise;

    // Half of the first track is a quarter of the book, and the second track's
    // halfway point is three quarters — never 50% twice.
    expect(seen).toEqual([25, 50, 75, 100]);
  });

  it("rejects with the reason the worker gave", async () => {
    const promise = downloadForOffline({
      fileIds: [4],
      bookId: 9,
      editionId: 3,
    });

    await Promise.resolve();
    await Promise.resolve();

    emit({ type: "bookCacheFailed", fileId: 4, reason: "quota" });
    await expect(promise).rejects.toThrow("quota");
  });

  it("ignores messages about files it did not ask for", async () => {
    let settled = false;
    const promise = downloadForOffline({
      fileIds: [4],
      bookId: 9,
      editionId: 3,
    }).then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    emit({ type: "bookCacheDone", fileId: 99 });
    await Promise.resolve();
    expect(settled).toBe(false);

    emit({ type: "bookCacheDone", fileId: 4 });
    await promise;
    expect(settled).toBe(true);
  });
});

describe("removeOffline", () => {
  it("evicts the whole set in one message", async () => {
    await removeOffline([4, 5]);
    expect(posted).toEqual([{ type: "evictBookFile", fileIds: [4, 5] }]);
  });
});
