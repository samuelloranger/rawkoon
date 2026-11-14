import { describe, expect, it } from "vitest";
import { takesSlot } from "./useLiveReorder";

describe("takesSlot", () => {
  const box = { top: 100, left: 0, width: 200, height: 40 };
  it("takes a row below only past its middle, and one above only before it", () => {
    expect(takesSlot(3, 1, { x: 0, y: 119 }, box, false)).toBe(false);
    expect(takesSlot(3, 1, { x: 0, y: 121 }, box, false)).toBe(true);
    expect(takesSlot(1, 3, { x: 0, y: 121 }, box, false)).toBe(false);
    expect(takesSlot(1, 3, { x: 0, y: 119 }, box, false)).toBe(true);
  });
  it("counts passing a neighbour's middle sideways in a grid only", () => {
    expect(takesSlot(3, 2, { x: 150, y: 100 }, box, true)).toBe(true);
    expect(takesSlot(3, 2, { x: 150, y: 100 }, box, false)).toBe(false);
  });
});
