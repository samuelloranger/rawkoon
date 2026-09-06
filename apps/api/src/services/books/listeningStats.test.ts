import { beforeEach, describe, expect, mock, test } from "bun:test";

const upserts: Array<{
  where: unknown;
  create: { seconds: number };
  update: { seconds: { increment: number } };
}> = [];

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
    },
  },
}));

mock.module("@rawkoon/api/config", () => ({
  loadConfig: () => ({ TZ: "America/Toronto" }),
}));

const { applyListeningCredit } = await import(
  "@rawkoon/api/services/books/listeningStats"
);

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
