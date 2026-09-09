import { describe, expect, it } from "bun:test";
import { printReport } from "./report";

const okResult = {
  route: { method: "GET", path: "/x" },
  kind: "positive" as const,
  ok: true,
  detail: "200",
  ms: 1,
};

describe("printReport", () => {
  it("returns non-zero when a result failed", () => {
    expect(
      printReport([{ ...okResult, ok: false, detail: "500" }], {
        uncovered: [],
        extra: [],
      }),
    ).toBe(1);
  });
  it("returns non-zero when a route is uncovered", () => {
    expect(
      printReport([], {
        uncovered: [{ method: "GET", path: "/y" }],
        extra: [],
      }),
    ).toBe(1);
  });
  it("returns non-zero on extra fixtures", () => {
    expect(printReport([], { uncovered: [], extra: ["GET /ghost"] })).toBe(1);
  });
  it("returns zero when all pass and coverage is clean", () => {
    expect(printReport([okResult], { uncovered: [], extra: [] })).toBe(0);
  });
});
