import { describe, it, expect, beforeEach, mock } from "bun:test";

// Regression test for the recovery handle on /qbittorrent/completed.
//
// Pre-fix: completeDownloadByHash returned null when a DH row already had
// completed_at set, so the webhook handler skipped enqueueLibraryPostProcess.
// That left the system stuck with status="downloaded" in the DB but the file
// still in the qB downloads dir — manual rescan was the only recovery.
//
// Post-fix: the function returns the DH id whenever a non-failed row exists
// for the hash, so the webhook can re-enqueue post-processing on every call.

const HASH = "a".repeat(40);

type DhRow = {
  id: number;
  torrentHash: string | null;
  completedAt: Date | null;
  failed: boolean;
  mediaId: number | null;
  episodeId: number | null;
  bookId: number | null;
  postProcessDestinationPath: string | null;
};

const state: {
  rows: DhRow[];
  markedComplete: number[];
  emittedMediaIds: number[];
} = {
  rows: [],
  markedComplete: [],
  emittedMediaIds: [],
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findFirst: ({
        where,
        orderBy,
      }: {
        where: { torrentHash: string; failed: boolean; completedAt?: null };
        orderBy?: { id?: "asc" | "desc" };
      }) => {
        const matches = state.rows.filter(
          (r) =>
            r.torrentHash === where.torrentHash &&
            r.failed === where.failed &&
            (where.completedAt === undefined ||
              r.completedAt === where.completedAt),
        );
        if (orderBy?.id === "desc") matches.sort((a, b) => b.id - a.id);
        else if (orderBy?.id === "asc") matches.sort((a, b) => a.id - b.id);
        return Promise.resolve(matches[0] ?? null);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: number };
        data: Partial<DhRow>;
      }) => {
        const row = state.rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
    libraryMedia: {
      update: () => Promise.resolve({}),
      updateMany: () => Promise.resolve({ count: 0 }),
      findUnique: () => Promise.resolve({ type: "show", tmdbStatus: null }),
    },
    libraryEpisode: { update: () => Promise.resolve({}) },
    libraryBook: { update: () => Promise.resolve({}) },
    mediaRequest: {
      findFirst: () => Promise.resolve(null),
      update: () => Promise.resolve({}),
    },
  },
}));

// Subscribe to the real libraryEventBus to capture emissions — don't mock
// the module (it has a `libraryEventBus` export consumed by other modules,
// and bun's mock.module is process-global, so a partial mock breaks them).
const { libraryEventBus } = await import("@rawkoon/api/services/libraryEvents");
libraryEventBus.on("update", (ev: { mediaId: number }) => {
  state.emittedMediaIds.push(ev.mediaId);
});

const { completeDownloadByHash } = await import(
  "@rawkoon/api/workers/checkDownloadCompletion"
);

describe("completeDownloadByHash", () => {
  beforeEach(() => {
    state.rows = [];
    state.markedComplete = [];
    state.emittedMediaIds = [];
  });

  it("returns null when no DH row matches the hash", async () => {
    const result = await completeDownloadByHash(HASH);
    expect(result).toBeNull();
  });

  it("returns null when the only matching row is failed=true", async () => {
    state.rows.push({
      id: 1,
      torrentHash: HASH,
      completedAt: null,
      failed: true,
      mediaId: 100,
      episodeId: null,
      bookId: null,
      postProcessDestinationPath: null,
    });
    const result = await completeDownloadByHash(HASH);
    expect(result).toBeNull();
  });

  it("marks a pending row complete and returns its id", async () => {
    state.rows.push({
      id: 42,
      torrentHash: HASH,
      completedAt: null,
      failed: false,
      mediaId: 10,
      episodeId: 20,
      bookId: null,
      postProcessDestinationPath: null,
    });
    const result = await completeDownloadByHash(HASH);
    expect(result).toBe(42);
    // emitLibraryUpdate fired for the media
    expect(state.emittedMediaIds).toContain(10);
    // row has completedAt populated
    expect(state.rows[0]?.completedAt).toBeInstanceOf(Date);
  });

  it("returns the id of an already-completed row WITHOUT marking it again (recovery handle)", async () => {
    const alreadyCompletedAt = new Date("2024-01-01T00:00:00Z");
    state.rows.push({
      id: 99,
      torrentHash: HASH,
      completedAt: alreadyCompletedAt,
      failed: false,
      mediaId: 10,
      episodeId: 20,
      bookId: null,
      postProcessDestinationPath: null,
    });
    const result = await completeDownloadByHash(HASH);
    // KEY assertion: the id is returned so the webhook can re-enqueue
    // post-processing even though the row is already complete.
    expect(result).toBe(99);
    // We did NOT touch the existing completedAt timestamp.
    expect(state.rows[0]?.completedAt).toBe(alreadyCompletedAt);
    // And we did NOT re-emit a library update (no work to broadcast).
    expect(state.emittedMediaIds).toEqual([]);
  });

  it("normalizes the hash before matching (uppercase / trailing whitespace)", async () => {
    state.rows.push({
      id: 7,
      torrentHash: HASH,
      completedAt: null,
      failed: false,
      mediaId: 1,
      episodeId: null,
      bookId: null,
      postProcessDestinationPath: null,
    });
    const result = await completeDownloadByHash(`  ${HASH.toUpperCase()}  `);
    expect(result).toBe(7);
  });

  it("prefers the newest PENDING row over an older completed row sharing the same hash", async () => {
    // Regression for Codex P1: when retries/re-grabs leave multiple DH rows
    // with the same hash, the lookup must mark the newest pending row
    // complete — not return an older already-completed row's id.
    const oldCompletedAt = new Date("2024-01-01T00:00:00Z");
    state.rows.push({
      id: 1,
      torrentHash: HASH,
      completedAt: oldCompletedAt,
      failed: false,
      mediaId: 10,
      episodeId: 20,
      bookId: null,
      postProcessDestinationPath: null,
    });
    state.rows.push({
      id: 2,
      torrentHash: HASH,
      completedAt: null,
      failed: false,
      mediaId: 10,
      episodeId: 21,
      bookId: null,
      postProcessDestinationPath: null,
    });

    const result = await completeDownloadByHash(HASH);

    // The newer pending row wins.
    expect(result).toBe(2);
    const pendingRow = state.rows.find((r) => r.id === 2);
    expect(pendingRow?.completedAt).toBeInstanceOf(Date);
    // The older row's completedAt is untouched.
    expect(state.rows.find((r) => r.id === 1)?.completedAt).toBe(
      oldCompletedAt,
    );
    expect(state.emittedMediaIds).toContain(10);
  });

  it("falls back to the newest COMPLETED row when no pending row exists", async () => {
    // Recovery handle: every row for this hash is already complete. Return
    // the newest one's id so the webhook can re-enqueue post-processing.
    state.rows.push({
      id: 1,
      torrentHash: HASH,
      completedAt: new Date("2024-01-01T00:00:00Z"),
      failed: false,
      mediaId: 10,
      episodeId: 20,
      bookId: null,
      postProcessDestinationPath: null,
    });
    state.rows.push({
      id: 2,
      torrentHash: HASH,
      completedAt: new Date("2024-02-01T00:00:00Z"),
      failed: false,
      mediaId: 10,
      episodeId: 21,
      bookId: null,
      postProcessDestinationPath: null,
    });

    const result = await completeDownloadByHash(HASH);
    expect(result).toBe(2);
    // Nothing flipped (no work to broadcast).
    expect(state.emittedMediaIds).toEqual([]);
  });

  it("returns null for an empty/whitespace-only hash", async () => {
    expect(await completeDownloadByHash("")).toBeNull();
    expect(await completeDownloadByHash("   ")).toBeNull();
  });
});
