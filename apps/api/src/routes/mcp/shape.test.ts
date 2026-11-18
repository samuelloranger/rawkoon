import { describe, expect, it } from "bun:test";
import { capList, capString, capToolResult } from "./shape";

describe("capString", () => {
  it("keeps short strings untouched", () => {
    expect(capString("hello")).toBe("hello");
  });

  it("cuts at 300 chars with an ellipsis marker", () => {
    const capped = capString("x".repeat(1000));
    expect(capped.length).toBe(300);
    expect(capped.endsWith("…")).toBe(true);
  });
});

describe("capToolResult", () => {
  it("truncates long nested strings", () => {
    const shaped = capToolResult({
      overview: "y".repeat(400),
      nested: { note: "z".repeat(400) },
    }) as { overview: string; nested: { note: string } };
    expect(shaped.overview.length).toBe(300);
    expect(shaped.nested.note.length).toBe(300);
  });

  it("caps a long array property with truncated and total flags", () => {
    const shaped = capToolResult({
      items: Array.from({ length: 40 }, (_, i) => i),
    }) as { items: { items: number[]; truncated: boolean; total: number } };
    expect(shaped.items.items).toHaveLength(25);
    expect(shaped.items.truncated).toBe(true);
    expect(shaped.items.total).toBe(40);
  });

  it("leaves short lists alone", () => {
    const shaped = capToolResult({ items: [1, 2, 3] }) as { items: number[] };
    expect(shaped.items).toEqual([1, 2, 3]);
  });
});

describe("capList", () => {
  it("flags truncation with the true total", () => {
    const out = capList(Array.from({ length: 30 }, (_, i) => i));
    expect(out.items).toHaveLength(25);
    expect(out.truncated).toBe(true);
    expect(out.total).toBe(30);
  });
});
