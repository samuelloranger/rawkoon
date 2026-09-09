import { describe, expect, it } from "bun:test";
import { coverageReport } from "./index";

const routes = [
  { method: "GET", path: "/api/system/version" },
  { method: "POST", path: "/api/requests" },
];

describe("coverageReport", () => {
  it("flags a route with no fixture as uncovered", () => {
    const { uncovered } = coverageReport(routes, {
      "GET /api/system/version": {},
    });
    expect(uncovered.map((r) => r.path)).toEqual(["/api/requests"]);
  });
  it("flags a fixture key matching no route as extra", () => {
    const { extra } = coverageReport(routes, {
      "GET /api/system/version": {},
      "POST /api/requests": {},
      "GET /api/ghost": {},
    });
    expect(extra).toEqual(["GET /api/ghost"]);
  });
  it("reports clean when fixtures exactly match routes", () => {
    const { uncovered, extra } = coverageReport(routes, {
      "GET /api/system/version": {},
      "POST /api/requests": {},
    });
    expect(uncovered).toEqual([]);
    expect(extra).toEqual([]);
  });
});
