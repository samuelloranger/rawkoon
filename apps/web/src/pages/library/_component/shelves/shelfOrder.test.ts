import { describe, expect, it } from "vitest";
import type { ShelfEntryView } from "@rawkoon/shared/types";
import { moveBefore, moveEntry, setGroupFrom, startsGroup } from "./shelfOrder";

const entry = (id: number, group_label: string | null): ShelfEntryView => ({
  id,
  tmdb_id: id,
  type: "movie",
  season: null,
  title: `t${id}`,
  year: null,
  poster_url: null,
  backdrop_url: null,
  group_label,
  position: id - 1,
  in_library: true,
  library_id: null,
  source: "manual",
  reason: null,
  excluded: false,
});

const labels = (list: ShelfEntryView[]) => list.map((e) => e.group_label);

describe("moveBefore", () => {
  it("moves an item down and up", () => {
    expect(moveBefore([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveBefore([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3]);
  });

  it("ignores -1, equal and out-of-range indices without mutating", () => {
    const list = [1, 2, 3];
    expect(moveBefore(list, -1, 1)).toEqual([1, 2, 3]);
    expect(moveBefore(list, 1, -1)).toEqual([1, 2, 3]);
    expect(moveBefore(list, 1, 1)).toEqual([1, 2, 3]);
    expect(moveBefore(list, 0, 3)).toEqual([1, 2, 3]);
    expect(list).toEqual([1, 2, 3]);
  });
});

describe("moveEntry", () => {
  it("keeps headers on their slots when a group's first title moves", () => {
    const list = [entry(1, "A"), entry(2, "A"), entry(3, "A"), entry(4, "B")];
    const moved = moveEntry(list, 0, 2);
    expect(moved.map((e) => e.id)).toEqual([2, 3, 1, 4]);
    expect(labels(moved)).toEqual(["A", "A", "A", "B"]);
    expect(moved.map((e) => e.position)).toEqual([0, 1, 2, 3]);
  });
});

describe("groups", () => {
  const list = [entry(1, null), entry(2, "A"), entry(3, "A"), entry(4, "B")];

  it("shows a header where the label changes", () => {
    expect(list.map((_, i) => startsGroup(list, i))).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("renames a whole group in one change", () => {
    expect(labels(setGroupFrom(list, 1, "C"))).toEqual([null, "C", "C", "B"]);
  });

  it("splits a group when a header is inserted mid-group", () => {
    expect(labels(setGroupFrom(list, 2, "C"))).toEqual([null, "A", "C", "B"]);
  });

  it("removes a header by joining the previous group", () => {
    expect(labels(setGroupFrom(list, 3, " "))).toEqual([null, "A", "A", "A"]);
    expect(labels(setGroupFrom(list, 1, ""))).toEqual([null, null, null, "B"]);
  });
});
