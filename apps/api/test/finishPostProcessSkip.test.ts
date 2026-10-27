import { describe, it, expect, beforeEach, mock } from "bun:test";
import { recordingEffects } from "./mocks/outcomeEffects";

/**
 * Regression (board task 723): a duplicate grab whose file another grab already
 * imported must NOT fire the "downloaded" admin notification — a skip is not a
 * fresh import. finishPostProcess threads `skipped`/`skipReason` from the
 * post-processor and (a) records postProcessSkipReason, (b) suppresses
 * mediaDownloaded.
 */

const state: {
  dhUpdates: Record<string, unknown>[];
  loads: number;
  rowsGiven: unknown[];
} = { dhUpdates: [], loads: 0, rowsGiven: [] };
let effects = recordingEffects();

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findUnique: async () => {
        state.loads += 1;
        return {
          id: 1,
          mediaId: 42,
          episodeId: null,
          season: null,
          bookEditionId: null,
          isUpgrade: false,
        };
      },
      update: async (args: { data: Record<string, unknown> }) => {
        state.dhUpdates.push(args.data);
        return { id: 1 };
      },
    },
    mediaSettings: { findUnique: async () => null },
  },
}));

mock.module("@rawkoon/api/services/postProcessor/postProcessorSingle", () => ({
  postProcess: async (row: unknown) => {
    state.rowsGiven.push(row);
    return {
      success: true,
      destinationPath: "/movies/Some Movie (2026).mkv",
      skipped: true,
      skipReason: "duplicate-already-imported",
    };
  },
}));

mock.module(
  "@rawkoon/api/services/postProcessor/postProcessorBookDownload",
  () => ({
    postProcessBookDownload: async () => ({
      success: false,
      reason: "unused",
    }),
  }),
);

mock.module("@rawkoon/api/services/downloads/downloadJanitor", () => ({
  rejectRelease: async () => {},
  findBlockedFileInTorrent: async () => null,
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => null,
}));

const { finishPostProcess } = await import(
  "@rawkoon/api/services/downloads/downloadOutcome"
);

beforeEach(() => {
  state.dhUpdates = [];
  state.loads = 0;
  state.rowsGiven = [];
  effects = recordingEffects();
});

describe("finishPostProcess duplicate skip", () => {
  it("records the skip reason and suppresses the downloaded notification", async () => {
    const result = await finishPostProcess(1, effects);

    expect(result.success).toBe(true);

    const write = state.dhUpdates.find(
      (d) => d.postProcessSkipReason === "duplicate-already-imported",
    );
    expect(write).toBeDefined();
    expect(write?.postProcessError).toBeNull();
    expect(write?.postProcessDestinationPath).toBe(
      "/movies/Some Movie (2026).mkv",
    );

    // A skip is not a fresh import — no "downloaded" admin notification.
    expect(effects.named("mediaDownloaded")).toHaveLength(0);
    expect(effects.named("importLanded")).toHaveLength(0);
  });

  it("loads the row once and hands that row to the post-processor", async () => {
    await finishPostProcess(1, effects);
    expect(state.loads).toBe(1);
    expect(state.rowsGiven).toMatchObject([{ id: 1, mediaId: 42 }]);
  });
});
