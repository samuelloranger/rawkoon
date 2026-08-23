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
    // The auth plugin loads OIDC providers at import time; without this it logs
    // a caught TypeError that looks like a test failure but is not one.
    oidcProvider: { findMany: () => Promise.resolve([]) },
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

const { searchRoutes } = await import("@rawkoon/api/routes/search/index");

type Handler = (ctx: {
  query: { q?: string; limit?: string };
  user: { id: string; is_admin: boolean };
  set: { status?: number };
}) => Promise<{
  books?: Array<{
    id: number;
    title: string;
    authors: string[];
    year: number | null;
  }>;
}>;

/** Pull the GET handler out of the Elysia instance to call it directly. */
function quickHandler(): Handler {
  const routes = (
    searchRoutes as unknown as {
      routes: Array<{ method: string; path: string; handler: Handler }>;
    }
  ).routes;
  const route = routes.find(
    (r) => r.method === "GET" && r.path.endsWith("/quick"),
  );
  if (!route) throw new Error("GET /quick not registered");
  return route.handler;
}

const call = (q: string) =>
  quickHandler()({
    query: { q },
    user: { id: "1", is_admin: false },
    set: {},
  });

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
