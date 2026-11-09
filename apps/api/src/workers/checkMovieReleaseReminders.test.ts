import { beforeEach, describe, expect, it, mock } from "bun:test";

const ymd = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

type Item = {
  id: number;
  userId: string;
  tmdbId: number;
  title: string;
  posterUrl: null;
  movieReleaseDate: Date | null;
  releaseReminderSentFor: string | null;
  user: { id: string; locale: string };
};
let items: Item[] = [];
const itemUpdate = mock(async (_a: unknown) => undefined);
const fetchDetails = mock(
  async (..._a: unknown[]): Promise<{ release_date: string | null }> => ({
    release_date: null,
  }),
);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    watchlistItem: { findMany: async () => items, update: itemUpdate },
  },
}));
mock.module("@rawkoon/api/utils/medias/tmdbFetcherCore", () => ({
  loadTmdbConfig: async () => ({ api_key: "k" }),
}));
mock.module("@rawkoon/api/utils/medias/tmdbFetcherDetails", () => ({
  fetchMediaDetails: fetchDetails,
}));
mock.module("@rawkoon/api/workers/notificationService", () => ({
  createAndQueueNotification: async () => true,
}));
mock.module("./notificationService", () => ({
  createAndQueueNotification: async () => true,
}));
mock.module(
  "@rawkoon/api/services/notification/notificationPreferences",
  () => ({
    getNotificationTarget: async () => null,
  }),
);

const { checkMovieReleaseReminders } = await import(
  "./checkMovieReleaseReminders"
);

const item = (over: Partial<Item>): Item => ({
  id: 1,
  userId: "u1",
  tmdbId: 10,
  title: "T",
  posterUrl: null,
  movieReleaseDate: null,
  releaseReminderSentFor: null,
  user: { id: "u1", locale: "en" },
  ...over,
});

beforeEach(() => {
  itemUpdate.mockClear();
  fetchDetails.mockClear();
  fetchDetails.mockImplementation(async () => ({ release_date: null }));
});

describe("checkMovieReleaseReminders", () => {
  it("keeps going after one TMDB lookup fails", async () => {
    items = [item({ id: 1, tmdbId: 1 }), item({ id: 2, tmdbId: 2 })];
    fetchDetails.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    await checkMovieReleaseReminders();
    expect(fetchDetails).toHaveBeenCalledTimes(2);
  });

  it("re-confirms a cached date that is about to fire, and stores a moved date", async () => {
    items = [item({ movieReleaseDate: new Date(`${ymd(2)}T00:00:00.000Z`) })];
    fetchDetails.mockImplementation(async () => ({ release_date: ymd(30) }));
    await checkMovieReleaseReminders();
    expect(fetchDetails).toHaveBeenCalledTimes(1);
    expect(itemUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch a date far in the future", async () => {
    items = [item({ movieReleaseDate: new Date(`${ymd(40)}T00:00:00.000Z`) })];
    await checkMovieReleaseReminders();
    expect(fetchDetails).not.toHaveBeenCalled();
  });
});
