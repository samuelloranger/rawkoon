import { describe, expect, it } from "bun:test";
import { httpUrlOrNull } from "./httpUrl";

describe("httpUrlOrNull", () => {
  it("keeps http(s) links", () => {
    expect(httpUrlOrNull("https://tracker.example/t/1")).toBe(
      "https://tracker.example/t/1",
    );
    expect(httpUrlOrNull("http://tracker.example/t/1")).toBe(
      "http://tracker.example/t/1",
    );
  });

  it("drops script and other schemes, and junk", () => {
    expect(httpUrlOrNull("javascript:alert(1)")).toBeNull();
    expect(httpUrlOrNull(" JavaScript:alert(1)")).toBeNull();
    expect(httpUrlOrNull("data:text/html,x")).toBeNull();
    expect(httpUrlOrNull("/relative")).toBeNull();
    expect(httpUrlOrNull(null)).toBeNull();
  });
});
