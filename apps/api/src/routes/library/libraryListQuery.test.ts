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
  it("is true for in-memory (aggregate/display-derived) sorts", () => {
    expect(isAggregateSort("file_size")).toBe(true);
    expect(isAggregateSort("last_grabbed_at")).toBe(true);
    // title/year are display-derived (overrides.title/year), so they are
    // ordered in memory.
    expect(isAggregateSort("title")).toBe(true);
    expect(isAggregateSort("year")).toBe(true);
  });
  it("is false for plain-column sorts", () => {
    expect(isAggregateSort("added_at")).toBe(false);
    expect(isAggregateSort("status")).toBe(false);
    expect(isAggregateSort("digital_release_date")).toBe(false);
  });
});

describe("buildSimpleOrderBy", () => {
  it("maps status with an id tie-break", () => {
    expect(buildSimpleOrderBy("status", "asc")).toEqual([
      { status: "asc" },
      { id: "asc" },
    ]);
  });
  it("orders nullable columns nulls-last", () => {
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
  it("throws for in-memory sorts", () => {
    expect(() => buildSimpleOrderBy("file_size", "asc")).toThrow();
    expect(() => buildSimpleOrderBy("title", "asc")).toThrow();
    expect(() => buildSimpleOrderBy("year", "asc")).toThrow();
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
    {
      id: 1,
      fileSizeTotal: 100n,
      lastGrabbedAt: 5,
      titleMapped: "Bravo",
      yearMapped: 2000,
    },
    {
      id: 2,
      fileSizeTotal: null,
      lastGrabbedAt: null,
      titleMapped: "Charlie",
      yearMapped: null,
    },
    {
      id: 3,
      fileSizeTotal: 300n,
      lastGrabbedAt: 9,
      titleMapped: "Alpha",
      yearMapped: 1990,
    },
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
  it("sorts title asc by mapped (display) title", () => {
    // Alpha(3), Bravo(1), Charlie(2)
    expect(orderAggregateIds(rows, "title", "asc")).toEqual([3, 1, 2]);
  });
  it("sorts title desc by mapped (display) title", () => {
    expect(orderAggregateIds(rows, "title", "desc")).toEqual([2, 1, 3]);
  });
  it("orders an overridden title by its display value, not raw column", () => {
    // Item renamed to 'Aardvark' via override must lead an asc sort even though
    // its raw title would place it late.
    const withOverride: AggregateSortRow[] = [
      {
        id: 10,
        fileSizeTotal: 1n,
        lastGrabbedAt: 1,
        titleMapped: "Zebra",
        yearMapped: 2020,
      },
      {
        id: 11,
        fileSizeTotal: 1n,
        lastGrabbedAt: 1,
        titleMapped: "Aardvark",
        yearMapped: 2020,
      },
    ];
    expect(orderAggregateIds(withOverride, "title", "asc")).toEqual([11, 10]);
  });
  it("sorts year asc, nulls last, id tie-break", () => {
    // 1990(3), 2000(1), null(2)
    expect(orderAggregateIds(rows, "year", "asc")).toEqual([3, 1, 2]);
  });
  it("sorts year desc, nulls last", () => {
    expect(orderAggregateIds(rows, "year", "desc")).toEqual([1, 3, 2]);
  });
  it("orders an overridden year by its display value, not raw column", () => {
    const withOverride: AggregateSortRow[] = [
      {
        id: 20,
        fileSizeTotal: 1n,
        lastGrabbedAt: 1,
        titleMapped: "A",
        yearMapped: 1980,
      },
      {
        id: 21,
        fileSizeTotal: 1n,
        lastGrabbedAt: 1,
        titleMapped: "B",
        yearMapped: 2024,
      },
    ];
    expect(orderAggregateIds(withOverride, "year", "desc")).toEqual([21, 20]);
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
