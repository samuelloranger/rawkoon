import { describe, it, expect, beforeEach, mock } from "bun:test";

// Regression test for the load-bearing fix: when mediaGrabber adopts an
// already-complete qBittorrent torrent (re-grab path), it must enqueue
// library post-processing so the file is actually placed in the library.
//
// Pre-fix: the adopt path flipped the DB to status='downloaded' but never
// called enqueueLibraryPostProcess. Files stayed in the qB downloads dir
// and only a manual rescan could move them into the library tree.

const enqueuedDhIds: number[] = [];
const completedQbState = "uploading"; // any state that satisfies isCompletedDownloadState
const incompleteQbState = "downloading";

const fakeTorrent = {
  hash: "a".repeat(40),
  category: "rawkoon-shows",
  tags: [] as string[],
  state: completedQbState,
  progress: 1,
};

const state: {
  qbCategoryCalls: Array<Record<string, unknown>>;
  qbTagCalls: Array<Record<string, unknown>>;
  dhUpdates: Array<{ where: { id: number }; data: Record<string, unknown> }>;
  episodeUpdates: Array<{
    where: { id: number };
    data: Record<string, unknown>;
  }>;
  mediaUpdates: Array<{ where: { id: number }; data: Record<string, unknown> }>;
  torrent: typeof fakeTorrent | null;
  approvedRequest: { id: number; requestedById: string; title: string } | null;
  requestUpdates: Array<{
    where: { id: number };
    data: Record<string, unknown>;
  }>;
  mediaStatus: string;
} = {
  qbCategoryCalls: [],
  qbTagCalls: [],
  dhUpdates: [],
  episodeUpdates: [],
  mediaUpdates: [],
  torrent: null,
  approvedRequest: null,
  requestUpdates: [],
  mediaStatus: "downloaded",
};

const dbMock = () => ({
  prisma: {
    downloadHistory: {
      update: (args: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        state.dhUpdates.push(args);
        return Promise.resolve({});
      },
    },
    libraryEpisode: {
      update: (args: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        state.episodeUpdates.push(args);
        return Promise.resolve({});
      },
    },
    libraryMedia: {
      update: (args: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        state.mediaUpdates.push(args);
        return Promise.resolve({});
      },
      findUnique: () =>
        Promise.resolve({
          type: "show",
          tmdbStatus: null,
          status: state.mediaStatus,
        }),
    },
    grabBlocklist: { findFirst: () => Promise.resolve(null) },
    mediaSettings: {
      findUnique: () => Promise.resolve({ postProcessingEnabled: true }),
    },
    mediaRequest: {
      findFirst: () => Promise.resolve(state.approvedRequest),
      update: (args: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        state.requestUpdates.push(args);
        return Promise.resolve({});
      },
    },
  },
});

mock.module("@rawkoon/api/workers/notificationService", () => ({
  createAndQueueNotification: () => Promise.resolve(undefined),
}));

const realQbConfig = await import("@rawkoon/api/services/qbittorrent/config");
mock.module("@rawkoon/api/services/qbittorrent/config", () => ({
  ...realQbConfig,
  getQbittorrentIntegrationConfig: () =>
    Promise.resolve({ enabled: true, config: { url: "http://qb" } }),
}));

// Spread the real module so unrelated consumers (postProcessor, dashboard
// routes, …) still see every export under Bun's process-global mock.module.
// Override only the functions this test exercises directly.
const realTorrentQueries = await import(
  "@rawkoon/api/services/qbittorrent/torrentQueries"
);
const realTorrentMutations = await import(
  "@rawkoon/api/services/qbittorrent/torrentMutations"
);
mock.module("@rawkoon/api/services/qbittorrent/torrentQueries", () => ({
  ...realTorrentQueries,
  fetchQbittorrentTorrent: () => Promise.resolve({ torrent: state.torrent }),
}));
mock.module("@rawkoon/api/services/qbittorrent/torrentMutations", () => ({
  ...realTorrentMutations,
  setQbittorrentTorrentCategory: (
    _cfg: unknown,
    _enabled: boolean,
    args: Record<string, unknown>,
  ) => {
    state.qbCategoryCalls.push(args);
    return Promise.resolve({ success: true });
  },
  setQbittorrentTorrentTags: (
    _cfg: unknown,
    _enabled: boolean,
    args: Record<string, unknown>,
  ) => {
    state.qbTagCalls.push(args);
    return Promise.resolve({ success: true });
  },
}));

mock.module("@rawkoon/api/utils/activityLogs", () => ({
  logActivity: () => Promise.resolve(undefined),
}));

// Adoption now goes through the download outcome module, so what this test
// asserts is that a completed adoption *queues post-processing* — not that a
// particular function was called.
const queueServiceMock = () => ({
  QUEUE_NAMES: { LIBRARY_POST_PROCESS: "library-post-process" },
  POST_PROCESS_JOB_NAME: "post-process",
  addJob: (
    _queue: string,
    _job: string,
    data: { downloadHistoryId: number },
  ) => {
    enqueuedDhIds.push(data.downloadHistoryId);
    return Promise.resolve({});
  },
});

// Registered at load AND before every test: mock.module is process-global and
// last-writer-wins, so whichever file `bun test` happens to walk last would
// otherwise decide whether this suite sees its own db and queue stubs. That
// ordering differs between a dev checkout and CI.
function installMocks() {
  mock.module("@rawkoon/api/db", dbMock);
  mock.module("@rawkoon/api/services/queueService", queueServiceMock);
}

installMocks();

// NOTE: do NOT mock @rawkoon/api/services/indexerManager,
// @rawkoon/api/services/integrationConfigCache,
// @rawkoon/api/utils/integrations/normalizers, or
// @rawkoon/api/utils/medias/safeTorrentFetchUrl. mediaGrabber imports them but
// `tryAdoptQbDuplicate` doesn't call into them, and bun's mock.module is
// process-global — stubbing them here would break other test files
// (e.g. safeTorrentFetchUrl.test.ts) that depend on the real implementations.

const { tryAdoptQbDuplicate } = await import(
  "@rawkoon/api/services/mediaGrabberAdopt"
);

const baseCtx = {
  dhRowId: 1,
  mediaId: 10,
  episodeId: 20,
  mediaType: "show",
  releaseTitle: "Example.Show.S01E02.1080p.WEB.x264-GROUP",
  qJson: {},
};

describe("tryAdoptQbDuplicate", () => {
  beforeEach(() => {
    installMocks();
    enqueuedDhIds.length = 0;
    state.qbCategoryCalls = [];
    state.qbTagCalls = [];
    state.dhUpdates = [];
    state.episodeUpdates = [];
    state.mediaUpdates = [];
    state.torrent = { ...fakeTorrent };
    state.approvedRequest = null;
    state.requestUpdates = [];
    state.mediaStatus = "downloaded";
  });

  // Adoption used to be a second, thinner finish path: it flipped the status by
  // hand and never told a waiting requester. Routing it through the download
  // outcome module fixes that.
  it("marks an approved request available when the adopted torrent is complete", async () => {
    state.approvedRequest = {
      id: 5,
      requestedById: "user-1",
      title: "Example",
    };

    await tryAdoptQbDuplicate({ ...baseCtx, torrentHash: fakeTorrent.hash });

    expect(state.requestUpdates).toHaveLength(1);
    expect(state.requestUpdates[0]?.data.status).toBe("available");
  });

  it("leaves an approved request alone while the adopted torrent is still downloading", async () => {
    state.approvedRequest = {
      id: 5,
      requestedById: "user-1",
      title: "Example",
    };
    state.torrent = {
      ...fakeTorrent,
      state: incompleteQbState,
      progress: 0.5,
    };

    await tryAdoptQbDuplicate({ ...baseCtx, torrentHash: fakeTorrent.hash });

    expect(state.requestUpdates).toEqual([]);
  });

  it("enqueues post-processing when the adopted torrent is already complete", async () => {
    state.torrent = {
      ...fakeTorrent,
      state: completedQbState,
      progress: 1,
    };

    const result = await tryAdoptQbDuplicate({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });

    expect(result).toEqual({ adopted: true, completed: true });
    // KEY assertion — this is the line that makes "had to manually rescan"
    // never happen again for adopted-complete torrents.
    expect(enqueuedDhIds).toEqual([1]);

    // Sanity: the episode was flipped to 'downloaded'.
    expect(state.episodeUpdates).toHaveLength(1);
    expect(state.episodeUpdates[0]?.data.status).toBe("downloaded");
  });

  it("does NOT enqueue post-processing when the adopted torrent is still downloading", async () => {
    state.torrent = {
      ...fakeTorrent,
      state: incompleteQbState,
      progress: 0.5,
    };

    const result = await tryAdoptQbDuplicate({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });

    expect(result).toEqual({ adopted: true, completed: false });
    expect(enqueuedDhIds).toEqual([]);
    // Episode set to 'downloading', not 'downloaded'.
    expect(state.episodeUpdates[0]?.data.status).toBe("downloading");
  });

  it("returns null and does nothing when the torrent is not found in qBittorrent", async () => {
    state.torrent = null;
    const result = await tryAdoptQbDuplicate({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });
    expect(result).toBeNull();
    expect(enqueuedDhIds).toEqual([]);
    expect(state.dhUpdates).toEqual([]);
  });

  it("returns null when no torrent hash is supplied", async () => {
    const result = await tryAdoptQbDuplicate({
      ...baseCtx,
      torrentHash: null,
    });
    expect(result).toBeNull();
    expect(enqueuedDhIds).toEqual([]);
  });
});
