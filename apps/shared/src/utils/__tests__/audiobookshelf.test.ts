import { describe, it, expect } from "bun:test";
import { audiobookshelfSearchUrl } from "../audiobookshelf";

describe("audiobookshelfSearchUrl", () => {
  it("builds a library search url", () => {
    expect(
      audiobookshelfSearchUrl(
        "https://audiobookshelf.samlo.cloud",
        "5bd62c95-771f-4bc2-9b05-b8ccd54a1507",
        "Fourth Wing",
      ),
    ).toBe(
      "https://audiobookshelf.samlo.cloud/library/5bd62c95-771f-4bc2-9b05-b8ccd54a1507/search?q=Fourth%20Wing",
    );
  });

  it("tolerates a trailing slash on the base url", () => {
    expect(
      audiobookshelfSearchUrl("https://abs.example.com/", "lib1", "Dune"),
    ).toBe("https://abs.example.com/library/lib1/search?q=Dune");
  });

  it("escapes characters that would break the query", () => {
    expect(
      audiobookshelfSearchUrl(
        "https://abs.example.com",
        "lib1",
        "Q&A / Vol. 2",
      ),
    ).toBe(
      "https://abs.example.com/library/lib1/search?q=Q%26A%20%2F%20Vol.%202",
    );
  });

  it("returns null when anything needed is missing", () => {
    expect(audiobookshelfSearchUrl(null, "lib1", "Dune")).toBeNull();
    expect(
      audiobookshelfSearchUrl("https://abs.example.com", null, "Dune"),
    ).toBeNull();
    expect(
      audiobookshelfSearchUrl("https://abs.example.com", "lib1", ""),
    ).toBeNull();
    expect(audiobookshelfSearchUrl("   ", "lib1", "Dune")).toBeNull();
    expect(
      audiobookshelfSearchUrl("https://abs.example.com", "   ", "Dune"),
    ).toBeNull();
  });

  it("refuses a base url that is not http(s)", () => {
    expect(
      audiobookshelfSearchUrl("javascript:alert(1)", "lib1", "Dune"),
    ).toBeNull();
    expect(audiobookshelfSearchUrl("not a url", "lib1", "Dune")).toBeNull();
  });
});
