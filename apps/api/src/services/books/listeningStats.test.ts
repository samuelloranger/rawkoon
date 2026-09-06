import { beforeEach, describe, expect, mock, test } from "bun:test";

const upserts: Array<{
  where: unknown;
  create: { seconds: number };
  update: { seconds: { increment: number } };
}> = [];

type MockLibraryBook = {
  title: string;
  seriesName: string | null;
  editions: Array<{
    progress: Array<{
      finished: boolean;
      positionSecs: number;
      totalDurationSecs: number;
      updatedAt: Date;
    }>;
  }>;
};

const dailyFindManyRows: Array<{ day: Date; seconds: number }> = [];
const libraryBooks: MockLibraryBook[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    oidcProvider: { findMany: () => Promise.resolve([]) },
    bookListeningDaily: {
      upsert: (args: (typeof upserts)[number]) => {
        if (args.create.seconds === 999) {
          return Promise.reject(new Error("disk full"));
        }
        upserts.push(args);
        return Promise.resolve({});
      },
      findMany: () => Promise.resolve(dailyFindManyRows),
    },
    libraryBook: {
      findMany: () => Promise.resolve(libraryBooks),
    },
  },
}));

mock.module("@rawkoon/api/config", () => ({
  loadConfig: () => ({ TZ: "America/Toronto" }),
}));

const { applyListeningCredit, getListeningStats } = await import(
  "@rawkoon/api/services/books/listeningStats"
);

const pinnedNow = new Date("2026-09-06T18:00:00.000Z");

describe("applyListeningCredit", () => {
  beforeEach(() => {
    upserts.length = 0;
  });

  test("first PUT (created) writes nothing", async () => {
    await applyListeningCredit({
      userId: "u1",
      created: true,
      previous: null,
      newPosition: 30,
      receivedAt: new Date("2026-09-06T18:00:00.000Z"),
    });
    expect(upserts).toHaveLength(0);
  });

  test("applied forward delta increments today", async () => {
    await applyListeningCredit({
      userId: "u1",
      created: false,
      previous: {
        positionSecs: 100,
        receivedAt: new Date("2026-09-06T17:59:50.000Z"),
      },
      newPosition: 112,
      receivedAt: new Date("2026-09-06T18:00:00.000Z"),
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].create.seconds).toBe(12);
    expect(upserts[0].update.seconds.increment).toBe(12);
  });

  test("increment throw is swallowed", async () => {
    await applyListeningCredit({
      userId: "u1",
      created: false,
      previous: {
        positionSecs: 0,
        receivedAt: new Date("2026-09-06T17:00:00.000Z"),
      },
      newPosition: 999,
      receivedAt: new Date("2026-09-06T18:00:00.000Z"),
    });
  });
});

describe("getListeningStats", () => {
  beforeEach(() => {
    dailyFindManyRows.length = 0;
    libraryBooks.length = 0;
  });

  test("no daily rows and no library books returns zeros", async () => {
    const stats = await getListeningStats("u1", pinnedNow);
    expect(stats.timezone).toBe("America/Toronto");
    expect(stats.today_secs).toBe(0);
    expect(stats.week_secs).toBe(0);
    expect(stats.streak_days).toBe(0);
    expect(stats.since).toBeNull();
    expect(stats.series).toEqual([]);
    expect(stats.week).toHaveLength(7);
  });

  test("two Discworld audiobooks with one finished and no daily rows", async () => {
    libraryBooks.push(
      {
        title: "Mort",
        seriesName: "Discworld",
        editions: [
          {
            progress: [
              {
                finished: true,
                positionSecs: 90,
                totalDurationSecs: 100,
                updatedAt: new Date("2026-09-01T12:00:00.000Z"),
              },
            ],
          },
        ],
      },
      {
        title: "Sourcery",
        seriesName: "Discworld",
        editions: [
          {
            progress: [
              {
                finished: false,
                positionSecs: 50,
                totalDurationSecs: 100,
                updatedAt: new Date("2026-09-05T12:00:00.000Z"),
              },
            ],
          },
        ],
      },
    );

    const stats = await getListeningStats("u1", pinnedNow);
    expect(stats.since).toBeNull();
    expect(stats.series).toHaveLength(1);
    expect(stats.series[0].percent).toBe(75);
  });
});
