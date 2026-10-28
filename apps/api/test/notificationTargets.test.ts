import { beforeEach, describe, expect, it, mock } from "bun:test";

const state: {
  notifications: Array<{
    title: string;
    body: string;
    url: string | undefined;
  }>;
  metadata: Array<Record<string, unknown> | undefined>;
  options: Array<Record<string, unknown> | undefined>;
  media: {
    id: number;
    title: string;
    year: number;
    type: "movie" | "show";
    posterUrl: string | null;
  } | null;
  episode: {
    season: number;
    episode: number;
    title: string | null;
  } | null;
} = {
  notifications: [],
  metadata: [],
  options: [],
  media: null,
  episode: null,
};

function installNotificationTargetMocks() {
  mock.module("@rawkoon/api/db", () => ({
    prisma: {
      libraryMedia: { findUnique: async () => state.media },
      libraryEpisode: { findUnique: async () => state.episode },
      user: {
        findMany: async () => [
          { id: "admin-1", locale: "en", notificationPreferences: null },
        ],
      },
    },
  }));

  mock.module("@rawkoon/api/workers/notificationService", () => ({
    getAllUsers: () => Promise.resolve([]),
    createAndQueueNotification: async (
      _userId: string,
      title: string,
      body: string,
      _type: string,
      url?: string,
      metadata?: Record<string, unknown>,
      _imageUrl?: string,
      options?: Record<string, unknown>,
    ) => {
      state.notifications.push({ title, body, url });
      state.metadata.push(metadata);
      state.options.push(options);
      return true;
    },
  }));
}

installNotificationTargetMocks();

const { notifyAdminsMediaDownloaded } = await import(
  "@rawkoon/api/workers/notifyMediaDownloaded"
);
const { notifyAdminsLibraryGrabSkipped } = await import(
  "@rawkoon/api/workers/notifyLibraryGrabSkipped"
);
const { notifyAdminsPostProcessFailed } = await import(
  "@rawkoon/api/workers/notifyPostProcessFailed"
);
const { notifyAdminsLibraryGrabbed, notifyAdminsLibraryDownloadFailed } =
  await import("@rawkoon/api/workers/notifyLibraryEvents");

describe("library notification targets", () => {
  beforeEach(() => {
    state.notifications = [];
    state.metadata = [];
    state.options = [];
    state.episode = null;
    state.media = {
      id: 42,
      title: "Dune",
      year: 2021,
      type: "movie",
      posterUrl: null,
    };
  });

  it("opens the downloaded media detail page", async () => {
    await notifyAdminsMediaDownloaded(42);

    expect(state.notifications).toEqual([
      {
        title: "Movie downloaded",
        body: "Dune (2021) is now in your library.",
        url: "/library/42?tab=files",
      },
    ]);
  });

  it("names the episode when a show episode finishes downloading", async () => {
    state.media = {
      id: 2497,
      title: "La maison des vilains",
      year: 2026,
      type: "show",
      posterUrl: null,
    };
    state.episode = { season: 1, episode: 3, title: "Episode 3" };

    await notifyAdminsMediaDownloaded({ mediaId: 2497, episodeId: 1959431 });

    expect(state.notifications).toEqual([
      {
        title: "S01E03 downloaded",
        body: "La maison des vilains (2026) — S01E03 is now in your library.",
        url: "/library/2497?tab=files&season=1&episode=3",
      },
    ]);
  });

  it("names a season pack with episode count", async () => {
    state.media = {
      id: 10,
      title: "Severance",
      year: 2022,
      type: "show",
      posterUrl: null,
    };

    await notifyAdminsMediaDownloaded({
      mediaId: 10,
      season: 1,
      episodeCount: 9,
    });

    expect(state.notifications[0]?.title).toBe("S01 downloaded");
    expect(state.notifications[0]?.body).toContain("9 episodes");
    expect(state.notifications[0]?.url).toBe("/library/10?tab=files&season=1");
  });

  it("includes a non-generic episode title in the body", async () => {
    state.media = {
      id: 10,
      title: "Severance",
      year: 2022,
      type: "show",
      posterUrl: null,
    };
    state.episode = { season: 1, episode: 1, title: "Good News About Hell" };

    await notifyAdminsMediaDownloaded({ mediaId: 10, episodeId: 100 });

    expect(state.notifications).toEqual([
      {
        title: "S01E01 downloaded",
        body: 'Severance (2022) — S01E01 "Good News About Hell" is now in your library.',
        url: "/library/10?tab=files&season=1&episode=1",
      },
    ]);
    expect(state.metadata[0]).toEqual({
      media_id: 10,
      subject: "Severance",
      code: "S01E01",
      detail: "Good News About Hell",
      latest_code: "S01E01",
      show: "Severance (2022)",
    });
  });

  it("carries the season code and count for a season pack", async () => {
    state.media = {
      id: 10,
      title: "Severance",
      year: 2022,
      type: "show",
      posterUrl: null,
    };

    await notifyAdminsMediaDownloaded({
      mediaId: 10,
      season: 1,
      episodeCount: 9,
      isUpgrade: true,
    });

    expect(state.metadata[0]).toEqual({
      media_id: 10,
      subject: "Severance",
      code: "S01",
      is_upgrade: true,
      episode_count: 9,
    });
  });

  it("opens the media detail page when an automatic grab is skipped", async () => {
    state.media = {
      id: 42,
      title: "Dune",
      year: 2021,
      type: "movie",
      posterUrl: null,
    };
    await notifyAdminsLibraryGrabSkipped({
      mediaId: 42,
      reason: "No suitable release",
      scope: "movie",
    });

    expect(state.notifications[0]?.url).toBe("/library/42?tab=files");
  });

  it("opens the media detail page when post-processing fails", async () => {
    state.media = {
      id: 42,
      title: "Dune",
      year: 2021,
      type: "movie",
      posterUrl: null,
    };
    await notifyAdminsPostProcessFailed(7, "Permission denied", 42);

    expect(state.notifications[0]?.url).toBe("/library/42?tab=files");
    expect(state.metadata[0]).toEqual({
      media_id: 42,
      subject: "Dune",
      detail: "Permission denied",
    });
  });

  describe("one notification per grab", () => {
    beforeEach(() => {
      state.media = {
        id: 10,
        title: "Severance",
        year: 2022,
        type: "show",
        posterUrl: null,
      };
      state.episode = { season: 1, episode: 2, title: "Half Loop" };
    });

    it("keeps a grab in the app without a push, keyed to the grab", async () => {
      await notifyAdminsLibraryGrabbed({
        mediaId: 10,
        downloadHistoryId: 7,
        episodeId: 100,
        releaseTitle: "Severance.S01E02.1080p.WEB-GRP",
      });

      expect(state.options[0]).toMatchObject({
        preferenceKey: "library_grabbed",
        push: false,
        lifecycleKey: "download:7",
      });
      expect(state.metadata[0]?.release).toBe("Severance.S01E02.1080p.WEB-GRP");
    });

    it("rewrites the grab's notification when its download lands", async () => {
      await notifyAdminsMediaDownloaded({
        mediaId: 10,
        downloadHistoryId: 7,
        episodeId: 100,
      });

      expect(state.options[0]).toEqual({
        lifecycleKey: "download:7",
        preferenceKey: "library_downloaded",
        skipPreferenceCheck: false,
      });
    });

    it("still merges episodes when the grab is unknown", async () => {
      await notifyAdminsMediaDownloaded({ mediaId: 10, episodeId: 100 });

      expect(state.options[0]?.groupKey).toBe("library_downloaded:10");
      expect(state.options[0]?.lifecycleKey).toBeUndefined();
    });

    it("turns the grab's notification into a failure", async () => {
      await notifyAdminsLibraryDownloadFailed({
        mediaId: 10,
        downloadHistoryId: 7,
        episodeId: 100,
        reason: "Torrent stalled",
      });

      expect(state.options[0]).toMatchObject({
        preferenceKey: "library_failed",
        lifecycleKey: "download:7",
      });
      expect(state.options[0]?.push).toBeUndefined();
    });

    it("keys a post-process failure to its grab", async () => {
      await notifyAdminsPostProcessFailed(7, "Permission denied", 10, 100);

      expect(state.options[0]?.lifecycleKey).toBe("download:7");
    });
  });
});
