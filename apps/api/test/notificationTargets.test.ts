import { beforeEach, describe, expect, it, mock } from "bun:test";

const state: {
  notifications: Array<{ url: string | undefined }>;
  media: {
    title: string;
    year: number;
    type: "movie" | "show";
    posterUrl: string | null;
  } | null;
} = {
  notifications: [],
  media: null,
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: { findUnique: async () => state.media },
    user: { findMany: async () => [{ id: "admin-1" }] },
  },
}));

mock.module("@rawkoon/api/workers/notificationService", () => ({
  createAndQueueNotification: async (
    _userId: string,
    _title: string,
    _body: string,
    _type: string,
    url?: string,
  ) => {
    state.notifications.push({ url });
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
    state.media = {
      title: "Dune",
      year: 2021,
      type: "movie",
      posterUrl: null,
    };
  });

  it("opens the downloaded media detail page", async () => {
    await notifyAdminsMediaDownloaded(42);

    expect(state.notifications).toEqual([{ url: "/library/42" }]);
  });

  it("opens the media detail page when an automatic grab is skipped", async () => {
    await notifyAdminsLibraryGrabSkipped("No suitable release", 42);

    expect(state.notifications).toEqual([{ url: "/library/42" }]);
  });

  it("opens the media detail page when post-processing fails", async () => {
    await notifyAdminsPostProcessFailed(7, "Permission denied", 42);

    expect(state.notifications).toEqual([{ url: "/library/42" }]);
  });
});
