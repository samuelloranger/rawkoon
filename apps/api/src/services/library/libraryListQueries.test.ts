import { beforeEach, describe, expect, it, mock } from "bun:test";

const findMany = mock(async (_args: unknown) => [] as unknown[]);
const groupBy = mock(async (_args: unknown) => []);
const queryRaw = mock(async (_q: unknown) => [] as unknown[]);

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMedia: { findMany, groupBy }, $queryRaw: queryRaw },
}));

const { queryLibraryList } = await import("./libraryListQueries");

const base = { titleLanguage: "en" as const };

type Call = { where: Record<string, unknown>; orderBy?: unknown };
const lastFind = () => findMany.mock.calls.at(-1)?.[0] as Call;

describe("queryLibraryList status and airing filters", () => {
  beforeEach(() => {
    findMany.mockClear();
    groupBy.mockClear();
    queryRaw.mockClear();
  });

  it("filters the stored acquisition status as is", async () => {
    await queryLibraryList({ ...base, status: "downloaded" });
    expect(lastFind().where).toEqual({ status: "downloaded" });
  });

  it("leaves an absent status out of the query", async () => {
    await queryLibraryList({ ...base });
    expect(lastFind().where).toEqual({});
  });

  it("turns the airing param into a show and TMDB status condition for the list and counts", async () => {
    await queryLibraryList({ ...base, airing: "returning", type: "movie" });
    const expected = [
      { type: "show", tmdbStatus: { in: ["Returning Series"] } },
    ];
    // The type filter must not overwrite the show condition from airing.
    expect(lastFind().where.AND).toEqual(expected);
    expect(lastFind().where.type).toBe("movie");
    const countWhere = (groupBy.mock.calls[0]?.[0] as { where: unknown }).where;
    expect(countWhere).toEqual({ AND: expected });
  });

  it("combines status and airing", async () => {
    await queryLibraryList({
      ...base,
      status: "downloaded",
      airing: "ended",
    });
    expect(lastFind().where).toEqual({
      status: "downloaded",
      AND: [{ type: "show", tmdbStatus: { in: ["Ended", "Canceled"] } }],
    });
  });

  it("applies both filters on the localized SQL path", async () => {
    await queryLibraryList({
      titleLanguage: "fr",
      status: "downloaded",
      airing: "planned",
      page: 1,
    });
    const sql = queryRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    const text = sql.strings.join("?");
    expect(text).toContain('m."status" = ?');
    expect(text).toContain('m."tmdb_status" IN');
    expect(sql.values).toContain("downloaded");
    expect(sql.values).toContain("Planned");
  });
});

describe("queryLibraryList sorted by status", () => {
  beforeEach(() => {
    findMany.mockClear();
    queryRaw.mockClear();
  });

  it("sorts on the stored column in Prisma and pages with skip/take", async () => {
    await queryLibraryList({
      ...base,
      page: 2,
      limit: 3,
      sort_by: "status",
      sort_dir: "desc",
    });
    const args = findMany.mock.calls.at(-1)?.[0] as {
      orderBy: unknown;
      skip: number;
      take: number;
    };
    expect(args.orderBy).toEqual([{ status: "desc" }, { id: "desc" }]);
    expect(args.skip).toBe(3);
    expect(args.take).toBe(4);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("sorts the localized path on the stored column too", async () => {
    queryRaw.mockImplementation(async () => []);
    await queryLibraryList({
      titleLanguage: "fr",
      page: 1,
      sort_by: "status",
      sort_dir: "asc",
    });
    const text = (
      queryRaw.mock.calls.at(-1)?.[0] as { strings: string[] }
    ).strings.join("?");
    expect(text).toContain('m."status" ASC');
    expect(text).not.toContain("CASE");
  });
});
