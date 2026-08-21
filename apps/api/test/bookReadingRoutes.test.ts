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
/** The SQL the finish/reset endpoints ran, so the two can be told apart. */
let lastSql = "";
let edition: { id: number } | null = { id: 5 };

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: { findUnique: async () => dbUser },
    bookEdition: { findUnique: async () => edition },
    $queryRaw: async (strings: TemplateStringsArray) => {
      lastSql = strings.join("?");
      return [
        {
          edition_id: 5,
          locator: null,
          percent: 0,
          position_secs: 0,
          file_id: null,
          finished_at: null,
          client_updated_at: new Date(),
          updated_at: new Date(),
        },
      ];
    },
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

const post = (path: string) =>
  app.handle(new Request(`http://localhost${path}`, { method: "POST" }));

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
    expect(lastTake).toBe(24);

    await get("/api/books/reading?limit=2");
    expect(lastTake).toBe(2);
  });

  it("refuses to turn a negative limit into a backwards page", async () => {
    // Prisma reads a negative `take` as pagination in the other direction,
    // which walked straight past the cap.
    const res = await get("/api/books/reading?limit=-1000000");

    expect(res.status).toBe(200);
    expect(lastTake).toBe(1);
  });

  it("floors a fractional limit instead of handing Prisma a decimal", async () => {
    // A non-integer take is a Prisma validation error, which surfaces as a 500.
    const res = await get("/api/books/reading?limit=3.7");

    expect(res.status).toBe(200);
    expect(lastTake).toBe(3);
  });
});

describe("ending a read", () => {
  beforeEach(() => {
    edition = { id: 5 };
    lastSql = "";
  });

  it("finishes an edition without being told a position", async () => {
    const res = await post("/api/books/editions/5/progress/finish");

    expect(res.status).toBe(200);
    // Only the finished columns are written, so the stored position survives.
    expect(lastSql).toContain("finished_at = NOW()");
    expect(lastSql).not.toContain("position_secs = ");
  });

  it("resets an edition to its beginning", async () => {
    const res = await post("/api/books/editions/5/progress/reset");

    expect(res.status).toBe(200);
    expect(lastSql).toContain("position_secs = 0");
    expect(lastSql).toContain("finished_at = NULL");
  });

  it("404s on an edition that does not exist", async () => {
    edition = null;

    const res = await post("/api/books/editions/999/progress/finish");
    expect(res.status).toBe(404);
  });
});
