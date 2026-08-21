import { describe, expect, it } from "bun:test";
import { isApiPath } from "@rawkoon/api/utils/isApiPath";

describe("isApiPath", () => {
  it("claims the api namespace", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/health")).toBe(true);
    expect(isApiPath("/api/books/files/1/META-INF/container.xml")).toBe(true);
  });

  it("leaves client-side routes to the SPA", () => {
    expect(isApiPath("/")).toBe(false);
    expect(isApiPath("/books/1/read")).toBe(false);
    expect(isApiPath("/apiary")).toBe(false);
    expect(isApiPath("/settings/api")).toBe(false);
  });
});
