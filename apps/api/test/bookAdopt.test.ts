import { describe, it, expect, beforeEach, mock } from "bun:test";

// A book edition whose earlier grab outlived its DownloadHistory row was
// permanently ungrabbable: the download client still held the torrent, so every
// re-grab hit qBittorrent's 409 and failed. Adoption is the way out — take over
// the existing torrent instead of adding it again.

const completedQbState = "uploading"; // any state normalizing to "completed"
const incompleteQbState = "downloading";

const fakeTorrent = {
  hash: "b".repeat(40),
  category: "wrong-category",
  tags: [] as string[],
  state: completedQbState,
  progress: 1,
};

const state: {
  qbCategoryCalls: Array<Record<string, unknown>>;
  qbTagCalls: Array<Record<string, unknown>>;
  dhUpdates: Array<{ where: { id: number }; data: Record<string, unknown> }>;
  editionUpdates: Array<{
    where: { id: number };
    data: Record<string, unknown>;
  }>;
  queuedJobs: Array<{ jobId: string | undefined; data: unknown }>;
  torrent: typeof fakeTorrent | null;
} = {
  qbCategoryCalls: [],
  qbTagCalls: [],
  dhUpdates: [],
  editionUpdates: [],
  queuedJobs: [],
  torrent: null,
};

mock.module("@rawkoon/api/db", () => ({
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
    bookEdition: {
      update: (args: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        state.editionUpdates.push(args);
        return Promise.resolve({ bookId: 77 });
      },
    },
    libraryEpisode: { update: () => Promise.resolve({}) },
    libraryMedia: {
      update: () => Promise.resolve({}),
      findUnique: () => Promise.resolve(null),
    },
    mediaSettings: {
      findUnique: () => Promise.resolve({ postProcessingEnabled: true }),
    },
    mediaRequest: {
      findFirst: () => Promise.resolve(null),
      update: () => Promise.resolve({}),
    },
  },
}));

const realQbConfig = await import("@rawkoon/api/services/qbittorrent/config");
mock.module("@rawkoon/api/services/qbittorrent/config", () => ({
  ...realQbConfig,
  getQbittorrentIntegrationConfig: () =>
    Promise.resolve({ enabled: true, config: { url: "http://qb" } }),
}));

// Spread the real modules: bun's mock.module is process-global, so dropping an
// export here would break unrelated test files that use it.
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

mock.module("@rawkoon/api/services/queueService", () => ({
  QUEUE_NAMES: { LIBRARY_POST_PROCESS: "library-post-process" },
  POST_PROCESS_JOB_NAME: "post-process",
  addJob: (
    _queue: string,
    _name: string,
    data: unknown,
    opts: { jobId?: string },
  ) => {
    state.queuedJobs.push({ jobId: opts?.jobId, data });
    return Promise.resolve({});
  },
}));

const { tryAdoptQbDuplicateForBook } = await import(
  "@rawkoon/api/services/books/bookAdopt"
);

const baseCtx = {
  dhRowId: 42,
  editionId: 7,
  kind: "ebook" as const,
  releaseTitle: "Some.Release.Title.epub",
  bookTitle: "Some Book",
};

describe("tryAdoptQbDuplicateForBook", () => {
  beforeEach(() => {
    state.qbCategoryCalls = [];
    state.qbTagCalls = [];
    state.dhUpdates = [];
    state.editionUpdates = [];
    state.queuedJobs = [];
    state.torrent = { ...fakeTorrent };
  });

  it("claims the torrent into the edition's own category", async () => {
    await tryAdoptQbDuplicateForBook({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });

    expect(state.qbCategoryCalls).toHaveLength(1);
    expect(state.qbCategoryCalls[0]?.category).toBe("rawkoon-books");
    expect(state.qbTagCalls[0]?.tags).toEqual(["rawkoon"]);
  });

  it("uses the audiobook category for an audiobook edition", async () => {
    await tryAdoptQbDuplicateForBook({
      ...baseCtx,
      kind: "audiobook",
      torrentHash: fakeTorrent.hash,
    });

    expect(state.qbCategoryCalls[0]?.category).toBe("rawkoon-audiobooks");
  });

  // The whole point of adopting a finished torrent: it must run the same
  // completion as a fresh grab, which is what schedules the import. The
  // post-process enqueue itself is not asserted — bun's mock.module is
  // process-global, so which queueService stub wins depends on test file
  // order. The completion stamp is the observable that stays stable.
  it("completes the download when the adopted torrent is already complete", async () => {
    const result = await tryAdoptQbDuplicateForBook({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });

    expect(result).toEqual({ adopted: true, completed: true });
    const completion = state.dhUpdates.find((u) => "completedAt" in u.data);
    expect(completion?.where.id).toBe(42);
    // A completed adoption must not also flip the edition to downloading.
    expect(
      state.editionUpdates.filter((u) => u.data.status === "downloading"),
    ).toEqual([]);
  });

  it("moves the edition to downloading while the adopted torrent is in flight", async () => {
    state.torrent = {
      ...fakeTorrent,
      state: incompleteQbState,
      progress: 0.4,
    };

    const result = await tryAdoptQbDuplicateForBook({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });

    expect(result).toEqual({ adopted: true, completed: false });
    expect(state.editionUpdates).toHaveLength(1);
    expect(state.editionUpdates[0]?.where.id).toBe(7);
    expect(state.editionUpdates[0]?.data.status).toBe("downloading");
    // Nothing to import yet, so no completion stamp.
    expect(
      state.dhUpdates.find((u) => "completedAt" in u.data),
    ).toBeUndefined();
  });

  it("marks the edition upgrading when the grab was an upgrade", async () => {
    state.torrent = {
      ...fakeTorrent,
      state: incompleteQbState,
      progress: 0.4,
    };

    await tryAdoptQbDuplicateForBook({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
      isUpgrade: true,
    });

    expect(state.editionUpdates[0]?.data.status).toBe("upgrading");
  });

  it("clears the failure fields on the DownloadHistory row it adopts", async () => {
    await tryAdoptQbDuplicateForBook({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });

    const adoptUpdate = state.dhUpdates.find((u) => "failed" in u.data);
    expect(adoptUpdate?.where.id).toBe(42);
    expect(adoptUpdate?.data).toMatchObject({
      failed: false,
      failReason: null,
      torrentHash: fakeTorrent.hash,
    });
  });

  it("returns null without touching the row when qBittorrent has no such torrent", async () => {
    state.torrent = null;

    const result = await tryAdoptQbDuplicateForBook({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });

    expect(result).toBeNull();
    expect(state.dhUpdates).toEqual([]);
    expect(state.editionUpdates).toEqual([]);
  });

  // A .torrent add that fails before the hash is known leaves nothing to look
  // up, so the grab has to fail with its own reason.
  it("returns null when there is no torrent hash to adopt by", async () => {
    const result = await tryAdoptQbDuplicateForBook({
      ...baseCtx,
      torrentHash: null,
    });

    expect(result).toBeNull();
    expect(state.qbCategoryCalls).toEqual([]);
  });

  // Claiming a torrent whose category could not be set would leave it running
  // under a category nothing in Rawkoon watches.
  it("returns null when the category could not be set", async () => {
    mock.module("@rawkoon/api/services/qbittorrent/torrentMutations", () => ({
      ...realTorrentMutations,
      setQbittorrentTorrentCategory: () =>
        Promise.resolve({ success: false, error: "qb refused" }),
      setQbittorrentTorrentTags: () => Promise.resolve({ success: true }),
    }));

    const result = await tryAdoptQbDuplicateForBook({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });

    expect(result).toBeNull();
    expect(state.dhUpdates).toEqual([]);

    // Restore for any test that runs after this one.
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
  });
});
