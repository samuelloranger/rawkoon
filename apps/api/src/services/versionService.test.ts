import { describe, expect, it } from "bun:test";
import { isEdgeVersion } from "./versionService";

describe("isEdgeVersion", () => {
  it("matches an edge build of main", () => {
    expect(isEdgeVersion("v1.40.4-main.312")).toBe(true);
    expect(isEdgeVersion("1.40.4-main.7")).toBe(true);
  });

  it("does not match a release or a dev build", () => {
    expect(isEdgeVersion("v1.40.3")).toBe(false);
    expect(isEdgeVersion("1.40.3")).toBe(false);
    expect(isEdgeVersion("0.0.0-dev+1760000000000")).toBe(false);
    expect(isEdgeVersion("v1.40.4-main")).toBe(false);
  });
});
