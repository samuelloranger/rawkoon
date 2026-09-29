import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Prisma } from "@prisma/client";

let pool: number[] = [];
const queryRaw = mock(async (query: Prisma.Sql) => {
  const excluded = new Set(
    query.values.slice(0, -1).filter((v): v is number => typeof v === "number"),
  );
  const take = query.values.at(-1) as number;
  return pool
    .filter((id) => !excluded.has(id))
    .slice(0, take)
    .map((id) => ({ id }));
});
const findMany = mock(async (args: { where: { id: { in: number[] } } }) =>
  [...args.where.id.in].reverse().map((id) => ({ id })),
);

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMedia: { findMany }, $queryRaw: queryRaw },
}));
mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireUser: async (_c: unknown, next: () => Promise<void>) => next(),
  ensureAdmin: () => null,
}));
mock.module("./libraryHelpers", () => ({
  libraryMediaInclude: {},
  mapLibraryMedia: (item: { id: number }) => ({ id: item.id }),
}));

const { libraryListRoutes } = await import("./libraryListRoutes");

async function ids(url: string): Promise<number[]> {
  const response = await libraryListRoutes.request(`http://localhost${url}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: { id: number }[] };
  return body.items.map((item) => item.id);
}

describe("GET /random", () => {
  beforeEach(() => {
    pool = [1, 2, 3, 4, 5, 6, 7, 8];
    queryRaw.mockClear();
  });

  it("keeps the random order the query returned", async () => {
    pool = [5, 2, 8];
    expect(await ids("/random?limit=3")).toEqual([5, 2, 8]);
  });

  it("only selects titles with something playable", async () => {
    await ids("/random");
    const sql = queryRaw.mock.calls[0]?.[0].strings.join("?") ?? "";
    expect(sql).toContain("downloaded_episode_count > 0");
    expect(sql).toContain("ORDER BY random()");
  });

  it("skips excluded ids while enough others remain", async () => {
    expect(await ids("/random?limit=3&exclude=1,2")).toEqual([3, 4, 5]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("tops up from excluded ids when too few others remain", async () => {
    pool = [1, 2, 3];
    expect(await ids("/random?limit=3&exclude=1,2")).toEqual([3, 1, 2]);
  });

  it("clamps the limit", async () => {
    await ids("/random?limit=500");
    expect(queryRaw.mock.calls[0]?.[0].values.at(-1)).toBe(24);
  });
});
