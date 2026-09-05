import { describe, it, expect, beforeEach, mock } from "bun:test";

/**
 * Regression (board task 723): a duplicate grab whose file another grab already
 * imported must NOT fire the "downloaded" admin notification — a skip is not a
 * fresh import. finishPostProcess threads `skipped`/`skipReason` from the
 * post-processor and (a) records postProcessSkipReason, (b) suppresses
 * notifyAdminsMediaDownloaded.
 */

const state: {
  dhUpdates: Record<string, unknown>[];
  mediaDownloadedCalls: unknown[];
} = { dhUpdates: [], mediaDownloadedCalls: [] };

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findUnique: async () => ({
        mediaId: 42,
        episodeId: null,
        season: null,
        bookEditionId: null,
        isUpgrade: false,
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        state.dhUpdates.push(args.data);
        return { id: 1 };
      },
    },
  },
}));

mock.module("@rawkoon/api/services/postProcessorSingle", () => ({
  postProcess: async () => ({
    success: true,
    destinationPath: "/movies/Some Movie (2026).mkv",
    skipped: true,
    skipReason: "duplicate-already-imported",
  }),
}));

mock.module("@rawkoon/api/services/postProcessorBook", () => ({
  postProcessBookDownload: async () => ({
    success: false,
    reason: "unused",
  }),
}));

mock.module("@rawkoon/api/services/libraryEvents", () => ({
  emitLibraryUpdate: () => {},
  emitBookUpdate: () => {},
}));

mock.module("@rawkoon/api/services/jellyfinLibraryRefresh", () => ({
  triggerJellyfinLibraryScan: async () => {},
}));

mock.module("@rawkoon/api/services/mediaRequests", () => ({
  notifyRequestAvailable: async () => {},
}));

mock.module("@rawkoon/api/workers/notifyMediaDownloaded", () => ({
  notifyAdminsMediaDownloaded: async (arg: unknown) => {
    state.mediaDownloadedCalls.push(arg);
  },
}));

mock.module("@rawkoon/api/workers/notifyLibraryEvents", () => ({
  notifyAdminsPostProcessFailed: async () => {},
  notifyAdminsLibraryDownloadFailed: async () => {},
}));

const { finishPostProcess } = await import(
  "@rawkoon/api/services/downloadOutcome"
);

beforeEach(() => {
  state.dhUpdates = [];
  state.mediaDownloadedCalls = [];
});

describe("finishPostProcess duplicate skip", () => {
  it("records the skip reason and suppresses the downloaded notification", async () => {
    const result = await finishPostProcess(1);

    expect(result.success).toBe(true);

    const write = state.dhUpdates.find(
      (d) => d.postProcessSkipReason === "duplicate-already-imported",
    );
    expect(write).toBeDefined();
    expect(write?.postProcessError).toBeNull();

    // A skip is not a fresh import — no "downloaded" admin notification.
    expect(state.mediaDownloadedCalls).toHaveLength(0);
  });
});
