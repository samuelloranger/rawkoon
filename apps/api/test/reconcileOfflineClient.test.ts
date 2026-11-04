import { beforeEach, describe, expect, it } from "bun:test";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";

// A torrent that stalls while the client itself has no network is not the
// release's fault: reconcile must neither blocklist it nor let the outage eat
// its stall timeout.

const {
  reconcilePendingDownloads,
  createReconcileState,
  OFFLINE_NOTIFY_AFTER_MS,
} = await import("@rawkoon/api/workers/checkDownloadCompletion");

const HASH = "b".repeat(40);
const settings = { stallTimeoutSecs: 60, maxAgeSecs: 3600 };

let failed: Array<{ id: number; reason: string }> = [];
let rejected: number[] = [];

const outcome = {
  completeDownload: (dh: { id: number }) => Promise.resolve(dh.id),
  completeDownloadByHash: () => Promise.resolve(null),
  failDownload: (dh: { id: number }, reason: string) => {
    failed.push({ id: dh.id, reason });
    return Promise.resolve();
  },
  rejectRelease: (dh: { id: number }) => {
    rejected.push(dh.id);
    return Promise.resolve();
  },
};

const stalled: NormalizedTorrent = {
  hash: HASH,
  name: "Example.S01E02.1080p",
  state: "stalled",
  progress: 0.1,
  savePath: "/downloads",
  contentPath: "/downloads/Example.S01E02.1080p",
  seeds: 0,
  peers: 0,
  dlSpeed: 0,
  upSpeed: 0,
  seedingTimeSecs: null,
  category: null,
  sizeBytes: 1024,
  labels: [],
  ratio: null,
};
const listTorrents = () => Promise.resolve([stalled]);

const row = {
  id: 1,
  mediaId: 10,
  episodeId: null,
  torrentHash: HASH,
  grabbedAt: new Date(),
};

describe("reconcilePendingDownloads with an offline client", () => {
  beforeEach(() => {
    failed = [];
    rejected = [];
  });

  it("holds a lone stalled release while the client cannot reach peers, then restarts its stall clock", async () => {
    const state = createReconcileState();
    const longAgo = Date.now() - 10_000;
    state.stallTracks.set(1, {
      createdAtMs: longAgo,
      lastProgress: 0.1,
      lastProgressAtMs: longAgo - 120_000,
    });
    let problem: string | null = "download client cannot reach any peer";
    const networkProblem = () => Promise.resolve(problem);
    const opts = { settings, state, listTorrents, outcome, networkProblem };

    await reconcilePendingDownloads([row], opts);
    expect(rejected).toEqual([]);
    expect(failed).toEqual([]);

    // Back online: the release gets a full stall timeout from now, not from before the outage.
    problem = null;
    await reconcilePendingDownloads([row], opts);
    expect(rejected).toEqual([]);
    expect(failed).toEqual([]);
  });

  it("tells admins once, only after the outage outlasts the notify delay", async () => {
    const state = createReconcileState();
    let problem: string | null = "download client cannot reach any peer";
    let notified = 0;
    const opts = {
      settings,
      state,
      listTorrents,
      outcome,
      networkProblem: () => Promise.resolve(problem),
      notifyOffline: () => {
        notified += 1;
        return Promise.resolve();
      },
    };

    await reconcilePendingDownloads([row], opts);
    expect(notified).toBe(0);

    state.offlineSinceMs = Date.now() - OFFLINE_NOTIFY_AFTER_MS - 1;
    await reconcilePendingDownloads([row], opts);
    await reconcilePendingDownloads([row], opts);
    expect(notified).toBe(1);

    // A later outage is a new one and gets its own notification.
    problem = null;
    await reconcilePendingDownloads([row], opts);
    expect(state.offlineSinceMs).toBeNull();
    problem = "download client is disconnected";
    await reconcilePendingDownloads([row], opts);
    state.offlineSinceMs = Date.now() - OFFLINE_NOTIFY_AFTER_MS - 1;
    await reconcilePendingDownloads([row], opts);
    expect(notified).toBe(2);
  });

  it("fails without blocklisting a release that hits max age while the client is offline", async () => {
    const oldRow = { ...row, grabbedAt: new Date(Date.now() - 10_000_000) };
    await reconcilePendingDownloads([oldRow], {
      settings,
      state: createReconcileState(),
      listTorrents,
      outcome,
      networkProblem: () => Promise.resolve("download client is disconnected"),
    });
    expect(rejected).toEqual([]);
    expect(failed).toEqual([
      { id: 1, reason: "exceeded max age with no completion" },
    ]);
  });
});
