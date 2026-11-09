import { beforeEach, describe, expect, it, mock } from "bun:test";
import { formatDateInTimezone } from "@rawkoon/api/utils";

// Calendar day in the display timezone, the same clock the worker uses.
const ymd = (offsetDays: number) => {
  const [y, m, d] = formatDateInTimezone(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays))
    .toISOString()
    .slice(0, 10);
};

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
  it("keeps going after one item fails, wherever it fails", async () => {
    items = [item({ id: 1, tmdbId: 1 }), item({ id: 2, tmdbId: 2 })];
    fetchDetails.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    await checkMovieReleaseReminders();
    expect(fetchDetails).toHaveBeenCalledTimes(2);

    // A failure later in the item (the update) is contained too.
    fetchDetails.mockClear();
    itemUpdate.mockImplementationOnce(async () => {
      throw new Error("db");
    });
    fetchDetails.mockImplementation(async () => ({ release_date: ymd(30) }));
    await checkMovieReleaseReminders();
    expect(fetchDetails).toHaveBeenCalledTimes(2);
  });

  it("re-confirms on the day before release and stores a moved date", async () => {
    items = [item({ movieReleaseDate: new Date(`${ymd(1)}T00:00:00.000Z`) })];
    fetchDetails.mockImplementation(async () => ({ release_date: ymd(30) }));
    await checkMovieReleaseReminders();
    expect(fetchDetails).toHaveBeenCalledTimes(1);
    expect(itemUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not write when the re-confirmed date is unchanged", async () => {
    items = [item({ movieReleaseDate: new Date(`${ymd(1)}T00:00:00.000Z`) })];
    fetchDetails.mockImplementation(async () => ({ release_date: ymd(1) }));
    await checkMovieReleaseReminders();
    expect(fetchDetails).toHaveBeenCalledTimes(1);
    // Only the "reminder sent" write remains.
    expect(itemUpdate).toHaveBeenCalledTimes(1);
    expect(itemUpdate.mock.calls[0]?.[0]).toMatchObject({
      data: { releaseReminderSentFor: ymd(1) },
    });
  });

  it("does not re-fetch on other days or once reminded", async () => {
    items = [
      item({ id: 1, movieReleaseDate: new Date(`${ymd(3)}T00:00:00.000Z`) }),
      item({ id: 2, movieReleaseDate: new Date(`${ymd(40)}T00:00:00.000Z`) }),
      item({
        id: 3,
        movieReleaseDate: new Date(`${ymd(1)}T00:00:00.000Z`),
        releaseReminderSentFor: ymd(1),
      }),
    ];
    await checkMovieReleaseReminders();
    expect(fetchDetails).not.toHaveBeenCalled();
  });
});
