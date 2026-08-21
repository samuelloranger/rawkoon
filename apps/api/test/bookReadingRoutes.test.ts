/**
 * GET /api/books/reading, through the same router composition the app uses.
 *
 * The composition is the risk: bookListRoutes registers GET /:id before this
 * route exists, so a literal segment that lost to the parameter would answer
 * "book 'reading' not found" instead of a list — the shape of bug the /search
 * route's comment in routes/books/index.ts already warns about.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";

const dbUser = {
  id: "u1",
  email: "reader@example.com",
  firstName: null,
  lastName: null,
  isAdmin: false,
  locale: null,
  lastLogin: null,
  createdAt: null,
  lastActivity: null,
  avatarUrl: null,
  navPosition: null,
  name: "Reader",
};

let progressRows: unknown[] = [];
let lastTake = 0;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: { findUnique: async () => dbUser },
    libraryBook: {
      findUnique: async () => null,
      findMany: async () => [],
      count: async () => 0,
    },
    bookProgress: {
      findMany: async ({ take }: { take: number }) => {
        lastTake = take;
        return progressRows;
      },
    },
  },
}));

mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: { getSession: async () => ({ user: { id: "u1" } }) },
    handler: async () => new Response("", { status: 404 }),
  },
  refreshOidcProviders: () => {},
}));

const { Elysia } = await import("elysia");
const { bookListRoutes } = await import(
  "@rawkoon/api/routes/books/bookListRoutes"
);
const { bookReadRoutes } = await import(
  "@rawkoon/api/routes/books/bookReadRoutes"
);

// Same order as routes/books/index.ts.
const app = new Elysia({ prefix: "/api/books" })
  .use(bookListRoutes)
  .use(bookReadRoutes);

const get = (path: string) =>
  app.handle(new Request(`http://localhost${path}`));

const progressRow = () => ({
  editionId: 5,
  percent: 0.37,
  positionSecs: null,
  updatedAt: new Date("2026-08-21T10:00:00.000Z"),
  edition: {
    kind: "ebook",
    durationSecs: null,
    book: {
      id: 42,
      title: "A Quiet Harbour",
      authors: ["M. Roy"],
      coverUrl: null,
    },
    files: [{ format: "epub", durationSecs: null }],
  },
});

describe("GET /api/books/reading", () => {
  beforeEach(() => {
    progressRows = [];
    lastTake = 0;
  });

  it("is not swallowed by GET /:id", async () => {
    const res = await get("/api/books/reading");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reading: [] });
  });

  it("returns the started books", async () => {
    progressRows = [progressRow()];

    const res = await get("/api/books/reading");
    const body = (await res.json()) as {
      reading: Array<{ book_id: number; title: string; percent: number }>;
    };

    expect(body.reading).toHaveLength(1);
    expect(body.reading[0].book_id).toBe(42);
    expect(body.reading[0].title).toBe("A Quiet Harbour");
    expect(body.reading[0].percent).toBe(0.37);
  });

  it("caps the limit, so a client cannot ask for the whole table", async () => {
    await get("/api/books/reading?limit=5000");
    const capped = lastTake;

    await get("/api/books/reading?limit=2");
    // Both are overfetched by a constant factor; what matters is that a huge
    // limit is clamped and a small one is honoured.
    expect(capped).toBeLessThan(200);
    expect(lastTake).toBeLessThan(capped);
  });
});
