import { describe, it, expect, beforeEach, mock } from "bun:test";
import { fakeAdapter } from "./mocks/downloadClientAdapter";

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
  dhUpdates: Array<{ where: { id: number }; data: Record<string, unknown> }>;
  editionUpdates: Array<{
    where: { id: number };
    data: Record<string, unknown>;
  }>;
  queuedJobs: Array<{ jobId: string | undefined; data: unknown }>;
  torrent: typeof fakeTorrent | null;
} = {
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

const { tryAdoptDuplicateForBook } = await import(
  "@rawkoon/api/services/books/bookAdopt"
);

const claimCalls: Array<{ hash: string; category: string; logPrefix: string }> =
  [];
// Stands in for the client: reports the staged torrent as claimable, or absent.
const adapter = fakeAdapter({
  claimExisting: async (opts) => {
    claimCalls.push(opts);
    if (!state.torrent) return null;
    return {
      completed:
        state.torrent.state === completedQbState && state.torrent.progress >= 1,
    };
  },
});

const baseCtx = {
  adapter,
  dhRowId: 42,
  editionId: 7,
  kind: "ebook" as const,
  releaseTitle: "Some.Release.Title.epub",
  bookTitle: "Some Book",
};

describe("tryAdoptDuplicateForBook", () => {
  beforeEach(() => {
    claimCalls.length = 0;
    state.dhUpdates = [];
    state.editionUpdates = [];
    state.queuedJobs = [];
    state.torrent = { ...fakeTorrent };
  });

  it("claims the torrent into the edition's own category", async () => {
    await tryAdoptDuplicateForBook({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
    });

    expect(claimCalls).toHaveLength(1);
    expect(claimCalls[0]?.category).toBe("rawkoon-books");
  });

  it("uses the audiobook category for an audiobook edition", async () => {
    await tryAdoptDuplicateForBook({
      ...baseCtx,
      kind: "audiobook",
      torrentHash: fakeTorrent.hash,
    });

    expect(claimCalls[0]?.category).toBe("rawkoon-audiobooks");
  });

  // The whole point of adopting a finished torrent: it must run the same
  // completion as a fresh grab, which is what schedules the import. The
  // post-process enqueue itself is not asserted — bun's mock.module is
  // process-global, so which queueService stub wins depends on test file
  // order. The completion stamp is the observable that stays stable.
  it("completes the download when the adopted torrent is already complete", async () => {
    const result = await tryAdoptDuplicateForBook({
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

    const result = await tryAdoptDuplicateForBook({
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

    await tryAdoptDuplicateForBook({
      ...baseCtx,
      torrentHash: fakeTorrent.hash,
      isUpgrade: true,
    });

    expect(state.editionUpdates[0]?.data.status).toBe("upgrading");
  });

  it("clears the failure fields on the DownloadHistory row it adopts", async () => {
    await tryAdoptDuplicateForBook({
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

    const result = await tryAdoptDuplicateForBook({
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
    const result = await tryAdoptDuplicateForBook({
      ...baseCtx,
      torrentHash: null,
    });

    expect(result).toBeNull();
    expect(claimCalls).toEqual([]);
  });
});
