import { describe, it, expect } from "bun:test";
import {
  parseLibrarySort,
  buildLibraryOrderBy,
  slicePage,
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

describe("buildLibraryOrderBy", () => {
  it("maps status with an id tie-break", () => {
    expect(buildLibraryOrderBy("status", "asc")).toEqual([
      { status: "asc" },
      { id: "asc" },
    ]);
  });
  it("orders nullable columns nulls-last", () => {
    expect(buildLibraryOrderBy("digital_release_date", "asc")).toEqual([
      { digitalReleaseDate: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ]);
  });
  it("maps added_at to addedAt", () => {
    expect(buildLibraryOrderBy("added_at", "desc")).toEqual([
      { addedAt: "desc" },
      { id: "desc" },
    ]);
  });
  it("orders title via persisted listTitle", () => {
    expect(buildLibraryOrderBy("title", "asc")).toEqual([
      { listTitle: "asc" },
      { id: "asc" },
    ]);
  });
  it("orders year via persisted listYear nulls-last", () => {
    expect(buildLibraryOrderBy("year", "desc")).toEqual([
      { listYear: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
  });
  it("orders file_size via totalSizeBytes nulls-last", () => {
    expect(buildLibraryOrderBy("file_size", "desc")).toEqual([
      { totalSizeBytes: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
  });
  it("orders last_grabbed_at with nulls as oldest", () => {
    expect(buildLibraryOrderBy("last_grabbed_at", "asc")).toEqual([
      { lastGrabbedAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ]);
    expect(buildLibraryOrderBy("last_grabbed_at", "desc")).toEqual([
      { lastGrabbedAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
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
