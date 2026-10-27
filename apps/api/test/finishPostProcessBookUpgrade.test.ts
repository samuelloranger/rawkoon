import { beforeEach, describe, expect, it, mock } from "bun:test";

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
  downloaded: [] as unknown[][],
  failed: [] as unknown[][],
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
mock.module("@rawkoon/api/services/postProcessor/postProcessorBook", () => ({
  postProcessBookDownload: async () => {
    if (state.bookResult instanceof Error) throw state.bookResult;
    return state.bookResult;
  },
}));
mock.module("@rawkoon/api/services/libraryEvents", () => ({
  emitLibraryUpdate: () => {},
  emitBookUpdate: () => {},
  emitSeedState: () => {},
  emitLibraryLanded: () => {},
}));
mock.module("@rawkoon/api/services/jellyfin/jellyfinLibraryRefresh", () => ({
  triggerJellyfinLibraryScan: async () => {},
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => null,
}));
mock.module("@rawkoon/api/workers/notifyBookEvents", () => ({
  notifyAdminsBookDownloaded: async (...args: unknown[]) => {
    state.downloaded.push(args);
  },
  notifyAdminsBookImportFailed: async (...args: unknown[]) => {
    state.failed.push(args);
  },
  notifyAdminsBookGrabbed: async () => {},
}));

const { finishPostProcess } = await import(
  "@rawkoon/api/services/downloads/downloadOutcome"
);

beforeEach(() => {
  state.dh.isUpgrade = true;
  state.bookResult = { success: true };
  state.downloaded = [];
  state.failed = [];
});

describe("finishPostProcess book upgrade notices", () => {
  it("flags a successful upgrade import", async () => {
    await finishPostProcess(1);
    expect(state.downloaded).toEqual([[11, true]]);
  });

  it("flags an upgrade whose import failed", async () => {
    state.bookResult = {
      success: false,
      reason: "Every candidate file failed to import",
    };
    await finishPostProcess(1);
    expect(state.failed).toEqual([
      [11, "Every candidate file failed to import", true],
    ]);
  });

  it("flags an upgrade whose post-processing threw", async () => {
    state.bookResult = new Error("disk unavailable");
    await finishPostProcess(1);
    expect(state.failed).toEqual([[11, "disk unavailable", true]]);
  });

  it("leaves a first grab unflagged", async () => {
    state.dh.isUpgrade = false;
    await finishPostProcess(1);
    expect(state.downloaded).toEqual([[11, false]]);
  });
});
