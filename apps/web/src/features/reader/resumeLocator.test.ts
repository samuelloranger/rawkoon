import { describe, it, expect } from "vitest";
import { resolveReadingPosition } from "./resumeLocator";

const spine = ["a.xhtml", "b.xhtml", "c.xhtml"];
const pos = (over: {
  spine_index: number;
  spine_path: string;
  scroll_fraction?: number;
}) => ({
  spine_index: over.spine_index,
  spine_path: over.spine_path,
  scroll_fraction: over.scroll_fraction ?? 0.4,
});

describe("resolveReadingPosition", () => {
  it("keeps the index when the path still matches", () => {
    expect(
      resolveReadingPosition(
        pos({ spine_index: 1, spine_path: "b.xhtml" }),
        spine,
      ),
    ).toEqual({ index: 1, scrollFraction: 0.4 });
  });

  it("follows the path when the spine was reordered", () => {
    expect(
      resolveReadingPosition(
        pos({ spine_index: 0, spine_path: "c.xhtml", scroll_fraction: 0.9 }),
        spine,
      ),
    ).toEqual({ index: 2, scrollFraction: 0.9 });
  });

  it("drops the offset when the path is gone", () => {
    expect(
      resolveReadingPosition(
        pos({
          spine_index: 9,
          spine_path: "removed.xhtml",
          scroll_fraction: 0.8,
        }),
        spine,
      ),
    ).toEqual({ index: 2, scrollFraction: 0 });
  });
});
