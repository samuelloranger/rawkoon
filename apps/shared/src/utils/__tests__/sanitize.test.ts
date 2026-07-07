import { describe, it, expect } from "bun:test";
import { sanitizeInput, isValidColor } from "../sanitize";

describe("sanitizeInput", () => {
  it("escapes < and >", () => {
    expect(sanitizeInput("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert('xss')&lt;/script&gt;",
    );
  });

  it("leaves normal text unchanged", () => {
    expect(sanitizeInput("Hello world")).toBe("Hello world");
  });

  it("escapes multiple occurrences", () => {
    expect(sanitizeInput("<b>bold</b> & <i>italic</i>")).toBe(
      "&lt;b&gt;bold&lt;/b&gt; & &lt;i&gt;italic&lt;/i&gt;",
    );
  });
});

describe("isValidColor", () => {
  it("accepts valid hex colors", () => {
    expect(isValidColor("#FF0000")).toBe(true);
    expect(isValidColor("#00ff00")).toBe(true);
    expect(isValidColor("#aaBB99")).toBe(true);
  });

  it("rejects invalid hex colors", () => {
    expect(isValidColor("#FFF")).toBe(false);
    expect(isValidColor("#GGGGGG")).toBe(false);
    expect(isValidColor("FF0000")).toBe(false);
  });

  it("accepts named CSS colors", () => {
    expect(isValidColor("red")).toBe(true);
    expect(isValidColor("blue")).toBe(true);
    expect(isValidColor("cornflowerblue")).toBe(true);
  });

  it("rejects strings with numbers or special chars as named colors", () => {
    expect(isValidColor("red1")).toBe(false);
    expect(isValidColor("not-a-color")).toBe(false);
  });
});
