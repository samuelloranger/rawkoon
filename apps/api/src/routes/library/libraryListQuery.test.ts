import { describe, it, expect } from "bun:test";
import {
  parseLibrarySort,
  isAggregateSort,
  buildSimpleOrderBy,
  slicePage,
  orderAggregateIds,
  reorderByIds,
  type AggregateSortRow,
} from "./libraryListQuery";

describe("parseLibrarySort", () => {
  it("passes through valid values", () => {
    expect(parseLibrarySort("title", "asc")).toEqual({
      sortBy: "title",
      sortDir: "asc",
    });
  });
  it("defaults unknown sortBy to added_at and unknown dir to desc", () => {
    expect(parseLibrarySort("bogus", "sideways")).toEqual({
      sortBy: "added_at",
      sortDir: "desc",
    });
  });
  it("defaults missing values", () => {
    expect(parseLibrarySort(undefined, undefined)).toEqual({
      sortBy: "added_at",
      sortDir: "desc",
    });
  });
});

describe("isAggregateSort", () => {
  it("is true for derived aggregates", () => {
    expect(isAggregateSort("file_size")).toBe(true);
    expect(isAggregateSort("last_grabbed_at")).toBe(true);
  });
  it("is false for simple columns", () => {
    expect(isAggregateSort("title")).toBe(false);
    expect(isAggregateSort("added_at")).toBe(false);
  });
});

describe("buildSimpleOrderBy", () => {
  it("maps title with an id tie-break", () => {
    expect(buildSimpleOrderBy("title", "asc")).toEqual([
      { title: "asc" },
      { id: "asc" },
    ]);
  });
  it("orders nullable columns nulls-last", () => {
    expect(buildSimpleOrderBy("year", "desc")).toEqual([
      { year: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(buildSimpleOrderBy("digital_release_date", "asc")).toEqual([
      { digitalReleaseDate: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ]);
  });
  it("maps added_at to addedAt", () => {
    expect(buildSimpleOrderBy("added_at", "desc")).toEqual([
      { addedAt: "desc" },
      { id: "desc" },
    ]);
  });
  it("throws for aggregate sorts", () => {
    expect(() => buildSimpleOrderBy("file_size", "asc")).toThrow();
  });
});

describe("slicePage", () => {
  it("reports has_more and trims the sentinel row", () => {
    expect(slicePage([1, 2, 3], 2)).toEqual({ items: [1, 2], has_more: true });
  });
  it("reports no more when under the limit", () => {
    expect(slicePage([1, 2], 2)).toEqual({ items: [1, 2], has_more: false });
  });
});

describe("orderAggregateIds", () => {
  const rows: AggregateSortRow[] = [
    { id: 1, fileSizeTotal: 100n, lastGrabbedAt: 5 },
    { id: 2, fileSizeTotal: null, lastGrabbedAt: null },
    { id: 3, fileSizeTotal: 300n, lastGrabbedAt: 9 },
  ];
  it("sorts file_size desc, nulls last, id tie-break", () => {
    expect(orderAggregateIds(rows, "file_size", "desc")).toEqual([3, 1, 2]);
  });
  it("sorts file_size asc, nulls last", () => {
    expect(orderAggregateIds(rows, "file_size", "asc")).toEqual([1, 3, 2]);
  });
  it("sorts last_grabbed_at desc treating null as oldest", () => {
    expect(orderAggregateIds(rows, "last_grabbed_at", "desc")).toEqual([
      3, 1, 2,
    ]);
  });
  it("sorts last_grabbed_at asc treating null as oldest", () => {
    expect(orderAggregateIds(rows, "last_grabbed_at", "asc")).toEqual([
      2, 1, 3,
    ]);
  });
});

describe("reorderByIds", () => {
  it("orders records by the id list and drops missing", () => {
    const recs = [
      { id: 3, v: "c" },
      { id: 1, v: "a" },
    ];
    expect(reorderByIds(recs, [1, 2, 3])).toEqual([
      { id: 1, v: "a" },
      { id: 3, v: "c" },
    ]);
  });
});
