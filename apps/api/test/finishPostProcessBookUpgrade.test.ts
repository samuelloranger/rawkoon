import { beforeEach, describe, expect, it, mock } from "bun:test";
import { recordingEffects } from "./mocks/outcomeEffects";

// Every book outcome of finishPostProcess must tell the notifier whether the
// grab was an upgrade, including the path where post-processing throws.

const state = {
  dh: {
    mediaId: null as number | null,
    episodeId: null as number | null,
    season: null,
    bookEditionId: 11 as number | null,
    isUpgrade: true,
    torrentHash: null as string | null,
    releaseTitle: "Some.Release.M4B",
    indexer: "Nimbus",
  },
  bookResult: { success: true } as Record<string, unknown> | Error,
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findUnique: async () => state.dh,
      update: async () => ({ id: 1 }),
    },
    mediaSettings: { findUnique: async () => ({ blockedExtensions: [] }) },
  },
}));
mock.module("@rawkoon/api/services/postProcessor/postProcessorSingle", () => ({
  postProcess: async () => ({ success: false, reason: "unused" }),
}));
mock.module(
  "@rawkoon/api/services/postProcessor/postProcessorBookDownload",
  () => ({
    postProcessBookDownload: async () => {
      if (state.bookResult instanceof Error) throw state.bookResult;
      return state.bookResult;
    },
  }),
);
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => null,
}));
const { finishPostProcess } = await import(
  "@rawkoon/api/services/downloads/downloadOutcome"
);

let effects = recordingEffects();

beforeEach(() => {
  state.dh.isUpgrade = true;
  state.bookResult = { success: true };
  effects = recordingEffects();
});

describe("finishPostProcess book upgrade notices", () => {
  it("flags a successful upgrade import", async () => {
    await finishPostProcess(1, effects);
    expect(effects.named("bookDownloaded")).toEqual([[11, true]]);
  });

  it("flags an upgrade whose import failed", async () => {
    state.bookResult = {
      success: false,
      reason: "Every candidate file failed to import",
    };
    await finishPostProcess(1, effects);
    expect(effects.named("importFailed")).toEqual([
      [
        {
          downloadHistoryId: 1,
          reason: "Every candidate file failed to import",
          mediaId: null,
          episodeId: null,
          bookEditionId: 11,
          isUpgrade: true,
        },
      ],
    ]);
  });

  it("flags an upgrade whose post-processing threw", async () => {
    state.bookResult = new Error("disk unavailable");
    await finishPostProcess(1, effects);
    expect(effects.named("importFailed")).toEqual([
      [
        {
          downloadHistoryId: 1,
          reason: "disk unavailable",
          mediaId: null,
          episodeId: null,
          bookEditionId: 11,
          isUpgrade: true,
        },
      ],
    ]);
  });

  it("leaves a first grab unflagged", async () => {
    state.dh.isUpgrade = false;
    await finishPostProcess(1, effects);
    expect(effects.named("bookDownloaded")).toEqual([[11, false]]);
  });
});
