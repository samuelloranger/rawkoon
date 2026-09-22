import { beforeEach, describe, expect, it, mock } from "bun:test";

const state = {
  rejected: [] as Array<{ id: number; kind: string; reason: string }>,
  postProcessFailedCalls: 0,
  evaluated: [] as string[],
  files: null as string[] | null,
  result: {
    success: false,
    reason: "No video file found",
    rejectKind: "no_content",
  } as Record<string, unknown>,
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findUnique: async () => ({
        mediaId: 42,
        episodeId: null,
        season: null,
        bookEditionId: null,
        isUpgrade: false,
        torrentHash: "ab".repeat(20),
        releaseTitle: "Some.Release",
        indexer: "Nimbus",
      }),
      update: async () => ({ id: 1 }),
    },
    mediaSettings: { findUnique: async () => ({ blockedExtensions: ["exe"] }) },
  },
}));
mock.module("@rawkoon/api/services/postProcessorSingle", () => ({
  postProcess: async () => state.result,
}));
mock.module("@rawkoon/api/services/postProcessorBook", () => ({
  postProcessBookDownload: async () => ({ success: false, reason: "unused" }),
}));
mock.module("@rawkoon/api/services/libraryEvents", () => ({
  emitLibraryUpdate: () => {},
  emitBookUpdate: () => {},
  emitSeedState: () => {},
}));
mock.module("@rawkoon/api/services/jellyfinLibraryRefresh", () => ({
  triggerJellyfinLibraryScan: async () => {},
}));
mock.module("@rawkoon/api/services/mediaRequests", () => ({
  notifyRequestAvailable: async () => {},
}));
mock.module("@rawkoon/api/workers/notifyMediaDownloaded", () => ({
  notifyAdminsMediaDownloaded: async () => {},
}));
mock.module("@rawkoon/api/workers/notifyLibraryEvents", () => ({
  notifyAdminsPostProcessFailed: async () => {
    state.postProcessFailedCalls += 1;
  },
  notifyAdminsLibraryDownloadFailed: async () => {},
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => ({
    adapter: { listFiles: async () => state.files },
  }),
}));
mock.module("@rawkoon/api/services/downloadJanitor", () => ({
  rejectRelease: async (dh: { id: number }, kind: string, reason: string) => {
    state.rejected.push({ id: dh.id, kind, reason });
  },
  findBlockedFileInTorrent: async (
    _h: string,
    exts: string[],
    a: { listFiles: () => Promise<string[] | null> },
  ) => {
    const files = await a.listFiles();
    return files?.find((f) => exts.some((e) => f.endsWith(`.${e}`))) ?? null;
  },
}));
mock.module("@rawkoon/api/services/seeding/seedSweep", () => ({
  evaluateSeedRelease: async (hash: string) => {
    state.evaluated.push(hash);
  },
}));

const { finishPostProcess } = await import(
  "@rawkoon/api/services/downloadOutcome"
);

beforeEach(() => {
  state.rejected = [];
  state.postProcessFailedCalls = 0;
  state.evaluated = [];
  state.files = ["Some/Some.mkv"];
  state.result = {
    success: false,
    reason: "No video file found",
    rejectKind: "no_content",
  };
});

describe("finishPostProcess rejects", () => {
  it("routes a content failure to rejectRelease instead of a post-process-failed notice", async () => {
    await finishPostProcess(1);
    expect(state.rejected).toEqual([
      { id: 1, kind: "import_rejected", reason: "No video file found" },
    ]);
    expect(state.postProcessFailedCalls).toBe(0);
  });
  it("keeps environmental failures retryable", async () => {
    state.result = {
      success: false,
      reason: "Movies library path not configured",
    };
    await finishPostProcess(1);
    expect(state.rejected).toEqual([]);
    expect(state.postProcessFailedCalls).toBe(1);
  });
  it("rejects a blocked file before importing anything", async () => {
    state.files = ["Some/Some.mkv", "Some/setup.exe"];
    const out = await finishPostProcess(1);
    expect(out.success).toBe(false);
    expect(state.rejected[0]).toMatchObject({ kind: "malware" });
  });
  it("evaluates the seed release after a successful import", async () => {
    state.result = { success: true, destinationPath: "/m/Some.mkv" };
    await finishPostProcess(1);
    expect(state.evaluated).toEqual(["ab".repeat(20)]);
  });
});
