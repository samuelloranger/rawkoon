import { describe, expect, it } from "vitest";
import { spinePositions } from "./spinePositions";

describe("spinePositions", () => {
  it("builds one locator per spine href with a totalProgression", () => {
    const locs = spinePositions([
      { href: "OEBPS/c1.xhtml" },
      { href: "OEBPS/c2.xhtml", type: "application/xhtml+xml" },
    ]);
    expect(locs).toHaveLength(2);
    expect(locs[0].href).toBe("OEBPS/c1.xhtml");
    expect(locs[0].locations.position).toBe(1);
    expect(locs[0].locations.totalProgression).toBe(0);
    expect(locs[1].locations.position).toBe(2);
    expect(locs[1].locations.totalProgression).toBe(0.5);
  });

  it("returns an empty list for an empty spine", () => {
    expect(spinePositions([])).toEqual([]);
  });
});
