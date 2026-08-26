import { beforeEach, describe, expect, it, mock } from "bun:test";

const state: {
  notifications: Array<{
    title: string;
    body: string;
    url: string | undefined;
  }>;
  media: {
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
  media: null,
  episode: null,
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: { findUnique: async () => state.media },
    libraryEpisode: { findUnique: async () => state.episode },
    user: { findMany: async () => [{ id: "admin-1" }] },
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
  ) => {
    state.notifications.push({ title, body, url });
    return true;
  },
}));

const { notifyAdminsMediaDownloaded } = await import(
  "@rawkoon/api/workers/notifyMediaDownloaded"
);
const { notifyAdminsLibraryGrabSkipped } = await import(
  "@rawkoon/api/workers/notifyLibraryGrabSkipped"
);
const { notifyAdminsPostProcessFailed } = await import(
  "@rawkoon/api/workers/notifyPostProcessFailed"
);

describe("library notification targets", () => {
  beforeEach(() => {
    state.notifications = [];
    state.episode = null;
    state.media = {
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
        url: "/library/42",
      },
    ]);
  });

  it("names the episode when a show episode finishes downloading", async () => {
    state.media = {
      title: "La maison des vilains",
      year: 2026,
      type: "show",
      posterUrl: null,
    };
    state.episode = { season: 1, episode: 3, title: "Episode 3" };

    await notifyAdminsMediaDownloaded(2497, 1959431);

    expect(state.notifications).toEqual([
      {
        title: "S01E03 downloaded",
        body: "La maison des vilains (2026) — S01E03 is now in your library.",
        url: "/library/2497",
      },
    ]);
  });

  it("includes a non-generic episode title in the body", async () => {
    state.media = {
      title: "Severance",
      year: 2022,
      type: "show",
      posterUrl: null,
    };
    state.episode = { season: 1, episode: 1, title: "Good News About Hell" };

    await notifyAdminsMediaDownloaded(10, 100);

    expect(state.notifications).toEqual([
      {
        title: "S01E01 downloaded",
        body: 'Severance (2022) — S01E01 "Good News About Hell" is now in your library.',
        url: "/library/10",
      },
    ]);
  });

  it("opens the media detail page when an automatic grab is skipped", async () => {
    await notifyAdminsLibraryGrabSkipped("No suitable release", 42);

    expect(state.notifications[0]?.url).toBe("/library/42");
  });

  it("opens the media detail page when post-processing fails", async () => {
    await notifyAdminsPostProcessFailed(7, "Permission denied", 42);

    expect(state.notifications[0]?.url).toBe("/library/42");
  });
});
