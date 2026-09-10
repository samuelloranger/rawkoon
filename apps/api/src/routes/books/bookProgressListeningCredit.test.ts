/**
 * Route tests for PUT /api/books/editions/:id/progress listening credit.
 *
 * Isolated from bookPlaybackRoutes.test.ts so mock.module('@rawkoon/api/db')
 * does not fight that file's content/range stubs. Auth follows
 * custom-formats/index.test.ts: real requireUser, stub Better Auth + user row.
 */
import { describe, expect, mock, test, beforeEach } from "bun:test";
import { Hono } from "hono";

const EPOCH = new Date(0);

type FakeUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean | null;
  locale: string | null;
  lastLogin: Date | null;
  createdAt: Date | null;
  lastActivity: Date | null;
  avatarUrl: string | null;
  navPosition: string | null;
} | null;

let injectedDbUser: FakeUser = null;
let existingProgress: {
  updatedAt: Date;
  positionSecs: number;
  receivedAt: Date;
} | null = null;
let creditThrows = false;
const dailyUpserts: Array<{
  create: { seconds: number };
  update: { seconds: { increment: number } };
}> = [];
let progressUpsertCount = 0;

const prismaStub = {
  oidcProvider: { findMany: async () => [] },
  user: {
    findUnique: mock(async () => injectedDbUser),
  },
  bookEdition: {
    findUnique: mock(async (args: { where: { id: number } }) =>
      args.where.id === 1 ? { id: 1 } : null,
    ),
  },
  bookListeningProgress: {
    findUnique: mock(async () => existingProgress),
    upsert: mock(async () => {
      progressUpsertCount += 1;
      return {};
    }),
  },
  bookListeningDaily: {
    upsert: mock(async (args: (typeof dailyUpserts)[number]) => {
      dailyUpserts.push(args);
      if (creditThrows) throw new Error("disk full");
      return {};
    }),
  },
};

mock.module("@rawkoon/api/db", () => ({ prisma: prismaStub }));

mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        injectedDbUser ? { user: { id: injectedDbUser.id } } : null,
    },
    handler: async () => new Response("", { status: 404 }),
  },
}));

const { bookProgressRoutes } = await import("./bookPlaybackRoutes");

// Mount at /api/books to drive the full /api/books/editions/:id/progress paths.
const app = new Hono().route("/api/books", bookProgressRoutes);

const USER: NonNullable<FakeUser> = {
  id: "user-id",
  email: "user@test.local",
  firstName: "User",
  lastName: null,
  isAdmin: false,
  locale: null,
  lastLogin: null,
  createdAt: EPOCH,
  lastActivity: null,
  avatarUrl: null,
  navPosition: null,
};

function putProgress(body: {
  position_secs: number;
  total_duration_secs: number;
  updated_at: string;
  finished?: boolean;
}) {
  return app.request(
    new Request("http://localhost/api/books/editions/1/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe.serial("PUT /api/books/editions/:id/progress listening credit", () => {
  beforeEach(() => {
    injectedDbUser = USER;
    existingProgress = null;
    creditThrows = false;
    dailyUpserts.length = 0;
    progressUpsertCount = 0;
    prismaStub.bookListeningProgress.findUnique.mockClear();
    prismaStub.bookListeningProgress.upsert.mockClear();
    prismaStub.bookListeningDaily.upsert.mockClear();
    prismaStub.user.findUnique.mockClear();
  });

  test("applied forward PUT credits today", async () => {
    const now = Date.now();
    existingProgress = {
      updatedAt: new Date(now - 60_000),
      positionSecs: 100,
      receivedAt: new Date(now - 10_000),
    };

    const res = await putProgress({
      position_secs: 112,
      total_duration_secs: 3600,
      updated_at: new Date(now).toISOString(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true });
    expect(progressUpsertCount).toBe(1);
    expect(dailyUpserts).toHaveLength(1);
    expect(dailyUpserts[0].create.seconds).toBe(12);
    expect(dailyUpserts[0].update.seconds.increment).toBe(12);
  });

  test("LWW loser returns applied false and does not credit", async () => {
    const now = Date.now();
    existingProgress = {
      updatedAt: new Date(now),
      positionSecs: 100,
      receivedAt: new Date(now - 10_000),
    };

    const res = await putProgress({
      position_secs: 200,
      total_duration_secs: 3600,
      updated_at: new Date(now - 60_000).toISOString(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: false });
    expect(progressUpsertCount).toBe(0);
    expect(dailyUpserts).toHaveLength(0);
  });

  test("credit throw still returns applied true", async () => {
    const now = Date.now();
    creditThrows = true;
    existingProgress = {
      updatedAt: new Date(now - 3_600_000),
      positionSecs: 0,
      receivedAt: new Date(now - 3_600_000),
    };

    const res = await putProgress({
      position_secs: 999,
      total_duration_secs: 3600,
      updated_at: new Date(now).toISOString(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true });
    expect(progressUpsertCount).toBe(1);
    expect(dailyUpserts).toHaveLength(1);
  });
});
