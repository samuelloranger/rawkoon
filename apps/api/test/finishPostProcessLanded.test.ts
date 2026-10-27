import { describe, it, expect, beforeEach, mock } from "bun:test";

/**
 * A fresh, non-upgrade import emits a `landed` event for Home; a skip, an
 * upgrade or a failing lookup does not, and never breaks the import.
 */

const state: {
  dh: Record<string, unknown>;
  skipped: boolean;
  mediaThrows: boolean;
  overrides: Record<string, unknown> | null;
  landed: Record<string, unknown>[];
} = {
  dh: {},
  skipped: false,
  mediaThrows: false,
  overrides: null,
  landed: [],
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findUnique: async () => state.dh,
      update: async () => ({ id: 1 }),
    },
    libraryMedia: {
      findUnique: async () => {
        if (state.mediaThrows) throw new Error("db down");
        return {
          title: "Some Show",
          year: 2024,
          type: "show",
          posterUrl: "/p.jpg",
          overrides: state.overrides,
        };
      },
    },
    libraryEpisode: {
      findUnique: async () => ({ season: 1, episode: 4 }),
    },
    mediaSettings: { findUnique: async () => null },
  },
}));

mock.module("@rawkoon/api/services/postProcessor/postProcessorSingle", () => ({
  postProcess: async () => ({
    success: true,
    destinationPath: "/tv/Some Show/S01E04.mkv",
    skipped: state.skipped,
  }),
}));

mock.module("@rawkoon/api/services/postProcessor/postProcessorBook", () => ({
  postProcessBookDownload: async () => ({ success: false, reason: "unused" }),
}));

mock.module("@rawkoon/api/services/libraryEvents", () => ({
  emitLibraryUpdate: () => {},
  emitBookUpdate: () => {},
  emitSeedState: () => {},
  emitLibraryLanded: (arrival: Record<string, unknown>) => {
    state.landed.push(arrival);
  },
}));

mock.module("@rawkoon/api/services/seeding/seedSweep", () => ({
  evaluateSeedRelease: async () => {},
}));
mock.module("@rawkoon/api/services/downloads/downloadJanitor", () => ({
  rejectRelease: async () => {},
  findBlockedFileInTorrent: async () => null,
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => null,
}));
mock.module("@rawkoon/api/services/jellyfin/jellyfinLibraryRefresh", () => ({
  triggerJellyfinLibraryScan: async () => {},
}));
mock.module("@rawkoon/api/services/mediaRequests", () => ({
  notifyRequestAvailable: async () => {},
}));
mock.module("@rawkoon/api/workers/notifyMediaDownloaded", () => ({
  notifyAdminsMediaDownloaded: async () => {},
}));
mock.module("@rawkoon/api/workers/notifyLibraryEvents", () => ({
  notifyAdminsPostProcessFailed: async () => {},
  notifyAdminsLibraryDownloadFailed: async () => {},
}));

const { finishPostProcess } = await import(
  "@rawkoon/api/services/downloads/downloadOutcome"
);

beforeEach(() => {
  state.dh = {
    mediaId: 42,
    episodeId: 7,
    season: 1,
    bookEditionId: null,
    isUpgrade: false,
  };
  state.skipped = false;
  state.mediaThrows = false;
  state.overrides = null;
  state.landed = [];
});

describe("finishPostProcess landed event", () => {
  it("emits an episode arrival with its label and numbers", async () => {
    await finishPostProcess(1);
    expect(state.landed).toEqual([
      {
        mediaId: 42,
        mediaType: "tv",
        title: "Some Show",
        posterUrl: "/p.jpg",
        season: 1,
        episode: 4,
        episodeCount: null,
      },
    ]);
  });

  it("uses the title and poster overrides when set", async () => {
    state.overrides = { title: "Custom", poster_url: "/custom.jpg" };
    await finishPostProcess(1);
    expect(state.landed[0]).toMatchObject({
      title: "Custom",
      posterUrl: "/custom.jpg",
    });
  });

  it("emits nothing for a skipped import or an upgrade", async () => {
    state.skipped = true;
    await finishPostProcess(1);
    state.skipped = false;
    state.dh = { ...state.dh, isUpgrade: true };
    await finishPostProcess(1);
    expect(state.landed).toHaveLength(0);
  });

  it("never fails the import when the lookup throws", async () => {
    state.mediaThrows = true;
    const result = await finishPostProcess(1);
    expect(result.success).toBe(true);
    expect(state.landed).toHaveLength(0);
  });
});
