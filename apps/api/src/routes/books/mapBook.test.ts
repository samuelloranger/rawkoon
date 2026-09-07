import { describe, expect, it } from "bun:test";
import { mapBook } from "@rawkoon/api/routes/books/bookHelpers";

const book = (over: Record<string, unknown> = {}) =>
  ({
    id: 7,
    googleVolumeId: "vol",
    isbn13: null,
    title: "Title",
    sortTitle: null,
    subtitle: null,
    overview: null,
    coverUrl: null,
    authors: [],
    language: "en",
    publishedYear: null,
    seriesName: null,
    seriesPosition: null,
    narrators: [],
    genres: [],
    publisher: null,
    pageCount: null,
    publishedDate: null,
    rating: null,
    ratingCount: null,
    addedAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    editions: [],
    ...over,
  }) as never;

describe("mapBook read_at", () => {
  it("is null when this user has not marked the book read", () => {
    expect(mapBook(book()).read_at).toBeNull();
  });

  it("serializes the user's read_at", () => {
    expect(
      mapBook(book(), { readAt: new Date("2026-09-06T12:00:00.000Z") }).read_at,
    ).toBe("2026-09-06T12:00:00.000Z");
  });
});
