import { describe, it, expect, beforeEach, mock } from "bun:test";

// Quick search is the one place a user types a title without first choosing a
// section, so a books install that answers movie titles only feels broken. The
// behaviours that carry weight: books are absent when the feature is off (and
// the table is not even queried), present when it is on, and a too-short query
// still returns a well-formed empty payload rather than undefined.

const state: {
  booksEnabled: boolean;
  bookQueries: unknown[];
  books: Array<{
    id: number;
    title: string;
    authors: string[];
    listYear: number | null;
  }>;
} = { booksEnabled: true, bookQueries: [], books: [] };

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    appSettings: {
      findUnique: () => Promise.resolve({ booksEnabled: state.booksEnabled }),
    },
    user: { findMany: () => Promise.resolve([]) },
    libraryMedia: { findMany: () => Promise.resolve([]) },
    libraryBook: {
      findMany: (args: unknown) => {
        state.bookQueries.push(args);
        return Promise.resolve(state.books);
      },
    },
  },
}));

// requireUser resolves the session user; stub it so the route runs as a signed-in
// non-admin without a real better-auth session.
mock.module("@rawkoon/api/middleware/auth", () => ({
  resolveUser: () => Promise.resolve({ id: "1", is_admin: false }),
}));

const { searchRoutes } = await import("@rawkoon/api/routes/search/index");

// Drive the Hono router through its test client; the prefix is stripped by the
// edge mount, so paths here are relative to the router root.
const call = async (
  q: string,
): Promise<{
  books?: Array<{
    id: number;
    title: string;
    authors: string[];
    year: number | null;
  }>;
}> => {
  const res = await searchRoutes.request(`/quick?q=${encodeURIComponent(q)}`);
  return res.json();
};

describe("GET /api/search/quick — books", () => {
  beforeEach(() => {
    state.booksEnabled = true;
    state.bookQueries = [];
    state.books = [
      { id: 7, title: "La prof", authors: ["Freida McFadden"], listYear: 2025 },
    ];
  });

  it("returns matching books when books are enabled", async () => {
    const result = await call("prof");

    expect(result.books).toEqual([
      { id: 7, title: "La prof", authors: ["Freida McFadden"], year: 2025 },
    ]);
    expect(state.bookQueries.length).toBe(1);
  });

  it("returns no books and skips the query when books are disabled", async () => {
    state.booksEnabled = false;

    const result = await call("prof");

    expect(result.books).toEqual([]);
    expect(state.bookQueries.length).toBe(0);
  });

  it("returns an empty books array for a too-short query", async () => {
    const result = await call("a");

    expect(result.books).toEqual([]);
    expect(state.bookQueries.length).toBe(0);
  });
});
