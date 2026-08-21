import { describe, it, expect, vi } from "vitest";

// The matchers decide what the service worker takes responsibility for, and the
// offline story broke last time precisely because the metadata requests were
// not among them.

vi.mock("./sw", () => ({
  sw: { location: { origin: "https://rawkoon.test" } },
}));

const { isBookContentRequest, isBookMetaRequest, isBuildAsset, BOOK_CACHE } =
  await import("./book-cache");

describe("isBookContentRequest", () => {
  it("matches a book file's content url", () => {
    expect(isBookContentRequest("/api/books/files/12/content")).toBe(true);
    expect(
      isBookContentRequest("https://rawkoon.test/api/books/files/12/content"),
    ).toBe(true);
  });

  it("ignores everything else under /api/books", () => {
    expect(isBookContentRequest("/api/books/12")).toBe(false);
    expect(isBookContentRequest("/api/books/files/12")).toBe(false);
    expect(isBookContentRequest("/api/books/editions/3/manifest")).toBe(false);
  });
});

describe("isBookMetaRequest", () => {
  it("matches the two requests needed to reopen a stored book", () => {
    expect(isBookMetaRequest("/api/books/12")).toBe(true);
    expect(isBookMetaRequest("/api/books/editions/3/manifest")).toBe(true);
  });

  it("does not claim the content route or unrelated book routes", () => {
    expect(isBookMetaRequest("/api/books/files/12/content")).toBe(false);
    expect(isBookMetaRequest("/api/books/search")).toBe(false);
    expect(isBookMetaRequest("/api/books/progress?editionIds=1")).toBe(false);
    expect(isBookMetaRequest("/api/books/12/editions/ebook/files")).toBe(false);
  });
});

describe("isBuildAsset", () => {
  it("matches same-origin hashed assets only", () => {
    expect(isBuildAsset("/assets/index-abc123.js")).toBe(true);
    expect(isBuildAsset("https://rawkoon.test/assets/app-1.css")).toBe(true);
    expect(isBuildAsset("https://cdn.example.com/assets/app-1.css")).toBe(
      false,
    );
    expect(isBuildAsset("/api/books/12")).toBe(false);
  });
});

describe("BOOK_CACHE", () => {
  it("is exported so activation can keep it", () => {
    // Regression guard: the activation handler deletes every cache whose name
    // is not recognised, which silently wiped explicitly downloaded books.
    expect(BOOK_CACHE).toBe("rawkoon-books");
  });
});
