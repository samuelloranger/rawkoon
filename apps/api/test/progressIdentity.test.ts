import { describe, it, expect } from "bun:test";
import { bookIdentityFromEdition } from "@rawkoon/api/routes/books/progressIdentity";

describe("bookIdentityFromEdition", () => {
  it("maps the book join", () => {
    expect(
      bookIdentityFromEdition({
        book: {
          id: 3,
          title: "L'intruse",
          authors: ["Freida McFadden"],
          coverUrl: "https://example/cover.jpg",
        },
      }),
    ).toEqual({
      book_id: 3,
      title: "L'intruse",
      authors: ["Freida McFadden"],
      cover_url: "https://example/cover.jpg",
    });
  });

  it("returns null when the edition is missing", () => {
    expect(bookIdentityFromEdition(null)).toBeNull();
  });
});
