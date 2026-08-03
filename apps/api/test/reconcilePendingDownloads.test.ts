import { describe, it, expect, beforeEach } from "bun:test";

// The reconcile loop is where the three finish paths converge, so it is the
// only place a regression in the unified download outcome shows up end-to-end.
//
// It became testable when the poll state stopped being module-global: each test
// builds a fresh ReconcileState instead of inheriting the previous test's stall
// tracks and backoff.

import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";

type Torrent = NormalizedTorrent;

const state: {
  torrents: Torrent[];
  completed: number[];
  failed: Array<{ id: number; reason: string }>;
  listThrows: boolean;
} = {
  torrents: [],
  completed: [],
  failed: [],
  listThrows: false,
};

// The torrent source is injected rather than module-mocked: several other test
// files register their own `downloadClient/registry` mock, and Bun's
// mock.module is process-global, so whichever file runs last would otherwise
// decide what this one sees.
function listTorrents(): Promise<Torrent[]> {
  if (state.listThrows) {
    return Promise.reject(new Error("client unreachable"));
  }
  return Promise.resolve(state.torrents);
}

// Reconcile is responsible for *deciding*, not for transitioning, so the
// outcome handlers are injected and simply recorded.
//
// Injected rather than module-mocked for the same reason as the torrent source,
// plus a harder one: mock.module cannot replace a module an earlier test file
// already imported for real, and completeDownloadByHash.test.ts imports the
// real download outcome module.
const outcome = {
  completeDownload: (dh: { id: number }) => {
    state.completed.push(dh.id);
    return Promise.resolve(dh.id);
  },
  completeDownloadByHash: () => Promise.resolve(null),
  failDownload: (dh: { id: number }, reason: string) => {
    state.failed.push({ id: dh.id, reason });
    return Promise.resolve();
  },
};

const { reconcilePendingDownloads, createReconcileState, findPendingTorrent } =
  await import("@rawkoon/api/workers/checkDownloadCompletion");

const HASH = "b".repeat(40);

function torrent(overrides: Partial<Torrent> = {}): Torrent {
  return {
    hash: HASH,
    name: "Example.S01E02.1080p",
    state: "downloading",
    progress: 0.5,
    savePath: "/downloads",
    contentPath: "/downloads/Example.S01E02.1080p",
    seeds: 3,
    peers: 1,
    dlSpeed: 1000,
    sizeBytes: 1024,
    labels: [],
    ratio: null,
    ...overrides,
  };
}

const settings = { stallTimeoutSecs: 60, maxAgeSecs: 3600 };

describe("reconcilePendingDownloads", () => {
  beforeEach(() => {
    state.torrents = [];
    state.completed = [];
    state.failed = [];
    state.listThrows = false;
  });

  const pendingRow = {
    id: 1,
    mediaId: 10,
    episodeId: null,
    torrentHash: HASH,
    grabbedAt: new Date(),
  };

  it("completes a row whose torrent finished", async () => {
    state.torrents = [torrent({ state: "completed", progress: 1 })];

    const result = await reconcilePendingDownloads([pendingRow], {
      settings,
      state: createReconcileState(),
      listTorrents,
      outcome,
    });

    expect(result).toEqual({ completed: 1, failed: 0, missing: 0 });
    expect(state.completed).toEqual([1]);
  });

  it("fails a row whose torrent reports an error", async () => {
    state.torrents = [torrent({ state: "error" })];

    const result = await reconcilePendingDownloads([pendingRow], {
      settings,
      state: createReconcileState(),
      listTorrents,
      outcome,
    });

    expect(result.failed).toBe(1);
    expect(state.failed[0]?.reason).toBe(
      "download client reported error state",
    );
  });

  it("waits — neither completing nor failing — while a torrent is progressing", async () => {
    state.torrents = [torrent()];
    const reconcileState = createReconcileState();

    const result = await reconcilePendingDownloads([pendingRow], {
      settings,
      state: reconcileState,
      listTorrents,
      outcome,
    });

    expect(result).toEqual({ completed: 0, failed: 0, missing: 0 });
    expect(reconcileState.lastReconcileHadActive).toBe(true);
    // The row is still in flight, so its stall track must survive the pass.
    expect(reconcileState.stallTracks.has(1)).toBe(true);
  });

  it("keeps the active cadence for a fresh magnet that has not found peers", async () => {
    // A public magnet sits at stalled/0% for its first passes. Backing off to
    // the idle interval here is what let a torrent finish unnoticed.
    state.torrents = [
      torrent({ state: "stalled", progress: 0, dlSpeed: 0, seeds: 0 }),
    ];
    const reconcileState = createReconcileState();

    await reconcilePendingDownloads([pendingRow], {
      settings,
      state: reconcileState,
      listTorrents,
      outcome,
    });

    expect(reconcileState.lastReconcileHadActive).toBe(true);
  });

  it("does not hold the active cadence for a paused torrent", async () => {
    state.torrents = [torrent({ state: "paused", dlSpeed: 0 })];
    const reconcileState = createReconcileState();

    await reconcilePendingDownloads([pendingRow], {
      settings,
      state: reconcileState,
      listTorrents,
      outcome,
    });

    expect(reconcileState.lastReconcileHadActive).toBe(false);
  });

  it("ignores a missing torrent by default, and fails it when asked", async () => {
    const quiet = await reconcilePendingDownloads([pendingRow], {
      settings,
      state: createReconcileState(),
      listTorrents,
      outcome,
    });
    expect(quiet).toEqual({ completed: 0, failed: 0, missing: 0 });
    expect(state.failed).toEqual([]);

    const loud = await reconcilePendingDownloads([pendingRow], {
      settings,
      treatMissingAsFailed: true,
      state: createReconcileState(),
      listTorrents,
      outcome,
    });
    expect(loud.missing).toBe(1);
    expect(state.failed[0]?.reason).toBe(
      "torrent missing from download client",
    );
  });

  it("stops tracking a row once its torrent disappears from the client", async () => {
    const reconcileState = createReconcileState();

    // First pass: the torrent is present and downloading, so it gets tracked.
    state.torrents = [torrent()];
    await reconcilePendingDownloads([pendingRow], {
      settings,
      state: reconcileState,
      listTorrents,
      outcome,
    });
    expect(reconcileState.stallTracks.has(1)).toBe(true);

    // Second pass: the user removed the torrent out-of-band. The track must be
    // dropped even though the row was not marked failed, or the map grows for
    // every torrent ever removed.
    state.torrents = [];
    await reconcilePendingDownloads([pendingRow], {
      settings,
      state: reconcileState,
      listTorrents,
      outcome,
    });
    expect(reconcileState.stallTracks.has(1)).toBe(false);
  });

  it("clears the stall track after a terminal outcome", async () => {
    const reconcileState = createReconcileState();
    state.torrents = [torrent({ state: "completed", progress: 1 })];

    await reconcilePendingDownloads([pendingRow], {
      settings,
      state: reconcileState,
      listTorrents,
      outcome,
    });

    expect(reconcileState.stallTracks.has(1)).toBe(false);
  });

  it("does nothing when the download client is unreachable", async () => {
    state.listThrows = true;
    const result = await reconcilePendingDownloads([pendingRow], {
      settings,
      state: createReconcileState(),
      listTorrents,
      outcome,
    });
    expect(result).toEqual({ completed: 0, failed: 0, missing: 0 });
    expect(state.completed).toEqual([]);
    expect(state.failed).toEqual([]);
  });

  // Asserted against findPendingTorrent rather than the loop: matching by tag
  // makes the loop persist the discovered hash, and the prisma mock that wins
  // process-wide is whichever test file registered one last.
  it("matches a row by its rawkoon tag when the hash is not yet known", () => {
    const tagged = torrent({
      hash: "c".repeat(40),
      state: "completed",
      progress: 1,
      labels: ["rawkoon-dh-1"],
    });

    expect(findPendingTorrent([tagged], 1, null)).toBe(tagged);
    expect(findPendingTorrent([tagged], 2, null)).toBeUndefined();
  });

  it("resolves every row in a single pass", async () => {
    state.torrents = [
      torrent({ hash: HASH, state: "completed", progress: 1 }),
      torrent({ hash: "d".repeat(40), state: "completed", progress: 1 }),
    ];

    const result = await reconcilePendingDownloads(
      [
        { ...pendingRow, id: 1, torrentHash: HASH },
        { ...pendingRow, id: 2, torrentHash: "d".repeat(40) },
      ],
      { settings, state: createReconcileState(), listTorrents, outcome },
    );

    expect(result.completed).toBe(2);
    expect(state.completed).toEqual([1, 2]);
  });
});
