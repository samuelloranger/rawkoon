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
    queryRaw.mockClear();
    queryRaw.mockImplementation(async () => [
      { id: 4 },
      { id: 2 },
      { id: 7 },
      { id: 1 },
    ]);
  });

  const lastSql = () =>
    queryRaw.mock.calls.at(-1)?.[0] as { strings: string[]; values: unknown[] };

  it("orders in SQL by the composite value clients read, then id", async () => {
    await queryLibraryList({
      ...base,
      page: 1,
      limit: 3,
      sort_by: "status",
      sort_dir: "desc",
    });
    const text = lastSql().strings.join("?");
    expect(text).toContain("CASE WHEN");
    expect(text).toContain('m."id" DESC');
    expect(text).toContain("LIMIT ? OFFSET ?");
  });

  it("pages in the database and reports more", async () => {
    const result = await queryLibraryList({
      ...base,
      page: 2,
      limit: 3,
      sort_by: "status",
      sort_dir: "asc",
    });
    expect(lastSql().values.slice(-2)).toEqual([4, 3]);
    expect(result.rows.map((r) => r.id)).toEqual([4, 2, 7]);
    expect(result.has_more).toBe(true);
  });

  it("applies the list filters to the sorted query", async () => {
    await queryLibraryList({
      ...base,
      page: 1,
      type: "show",
      status: "returning",
      q: "abc",
      language: "fr",
      sort_by: "status",
    });
    const { strings, values } = lastSql();
    const text = strings.join("?");
    expect(text).toContain('m."type" = ?');
    expect(text).toContain('m."tmdb_status" = ?');
    expect(text).toContain('m."title" ILIKE ?');
    expect(text).toContain("language_tags");
    expect(values).toEqual(
      expect.arrayContaining(["show", "Returning Series", "%abc%", "fr"]),
    );
  });
});
