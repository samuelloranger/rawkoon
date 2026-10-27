import { beforeEach, describe, expect, it, mock } from "bun:test";

type Row = {
  id: number;
  type: string;
  status: string;
  tmdbStatus: string | null;
};

let rows: Row[] = [];
const findMany = mock(async (args: { where?: unknown; select?: unknown }) => {
  if (args.select) return rows;
  const ids = (args.where as { id?: { in: number[] } }).id?.in;
  return ids ? ids.map((id) => ({ id })) : [];
});
const groupBy = mock(async (_args: unknown) => []);
const queryRaw = mock(async (_q: unknown) => [] as unknown[]);

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMedia: { findMany, groupBy }, $queryRaw: queryRaw },
}));

const { queryLibraryList } = await import("./libraryListQueries");

const base = { titleLanguage: "en" as const };

describe("queryLibraryList status filter", () => {
  beforeEach(() => {
    findMany.mockClear();
    groupBy.mockClear();
  });

  it("translates a composite status for the list and the type counts", async () => {
    await queryLibraryList({ ...base, status: "returning", type: "movie" });
    const expected = [
      { status: "downloaded", type: "show", tmdbStatus: "Returning Series" },
    ];
    const listWhere = findMany.mock.calls[0]?.[0].where as {
      AND: unknown[];
      type: string;
    };
    // The type filter must not overwrite the show condition from the status.
    expect(listWhere.AND).toEqual(expected);
    expect(listWhere.type).toBe("movie");
    const countWhere = (groupBy.mock.calls[0]?.[0] as { where: unknown }).where;
    expect(countWhere).toEqual({ AND: expected });
  });

  it("leaves an absent status out of the query", async () => {
    await queryLibraryList({ ...base });
    expect(findMany.mock.calls[0]?.[0].where).toEqual({});
  });

  it("uses the localized SQL path with the same translation", async () => {
    await queryLibraryList({
      titleLanguage: "fr",
      status: "planned",
      page: 1,
    });
    const sql = queryRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(sql.strings.join("?")).toContain('m."tmdb_status" = ?');
    expect(sql.values).toContain("Planned");
  });
});

describe("queryLibraryList sorted by status", () => {
  beforeEach(() => {
    findMany.mockClear();
    rows = [
      { id: 1, type: "movie", status: "wanted", tmdbStatus: null },
      {
        id: 2,
        type: "show",
        status: "downloaded",
        tmdbStatus: "Returning Series",
      },
      { id: 3, type: "show", status: "downloaded", tmdbStatus: "Ended" },
      { id: 4, type: "show", status: "downloaded", tmdbStatus: "Planned" },
      { id: 5, type: "movie", status: "downloading", tmdbStatus: null },
      {
        id: 6,
        type: "show",
        status: "downloaded",
        tmdbStatus: "In Production",
      },
      { id: 7, type: "movie", status: "skipped", tmdbStatus: null },
    ];
  });

  const ids = async (sortDir: string, page = 1, limit = 100) => {
    const result = await queryLibraryList({
      ...base,
      page,
      limit,
      sort_by: "status",
      sort_dir: sortDir,
    });
    return result.rows.map((r) => r.id);
  };

  it("orders airing shows by the composite value clients read", async () => {
    // downloaded, downloading, in_production, planned, returning, skipped, wanted
    expect(await ids("asc")).toEqual([3, 5, 6, 4, 2, 7, 1]);
  });

  it("reverses for descending", async () => {
    expect(await ids("desc")).toEqual([1, 7, 2, 4, 6, 5, 3]);
  });

  it("pages over the folded order and reports more", async () => {
    const result = await queryLibraryList({
      ...base,
      page: 2,
      limit: 3,
      sort_by: "status",
      sort_dir: "asc",
    });
    expect(result.rows.map((r) => r.id)).toEqual([4, 2, 7]);
    expect(result.has_more).toBe(true);
  });
});
