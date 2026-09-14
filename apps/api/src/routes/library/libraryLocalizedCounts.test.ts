import { describe, expect, it, mock } from "bun:test";
import type { Prisma } from "@prisma/client";

const groupBy = mock(async () => [{ type: "movie", _count: 0 }]);
const queryRaw = mock(async (query: Prisma.Sql) => {
  const sql = query.strings.join("?");
  if (sql.includes("GROUP BY") && query.values.includes("%parrain%")) {
    return [{ type: "movie", _count: 1 }];
  }
  return [{ id: 7 }];
});
const findMany = mock(async () => [{ id: 7, title: "The Godfather" }]);

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMedia: { groupBy, findMany }, $queryRaw: queryRaw },
}));
mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireUser: async (_c: unknown, next: () => Promise<void>) => next(),
  ensureAdmin: () => null,
}));
mock.module("./libraryHelpers", () => ({
  libraryMediaInclude: {},
  mapLibraryMedia: (item: { id: number }) => ({
    id: item.id,
    title: "Le Parrain",
  }),
}));

const { libraryListRoutes } = await import("./libraryListRoutes");

describe("localized library search counts", () => {
  it("counts the French match returned in the result list", async () => {
    const response = await libraryListRoutes.request(
      "http://localhost/?q=parrain&title_language=fr&page=1",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: { id: number }[];
      movie_count: number;
    };
    expect(body.items.map((item) => item.id)).toEqual([7]);
    expect(body.movie_count).toBe(1);
  });
});
