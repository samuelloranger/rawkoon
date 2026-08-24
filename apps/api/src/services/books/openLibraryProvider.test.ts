import { describe, expect, test } from "bun:test";
import {
  isHtmlBody,
  mapOpenLibraryDoc,
} from "@rawkoon/api/services/books/openLibraryProvider";
import search from "../../../test/fixtures/bookMetadata/openlibrary-search.json";

describe("mapOpenLibraryDoc", () => {
  test("contributes only the fields Open Library is actually good for", () => {
    const f = mapOpenLibraryDoc(search.docs[0]);
    expect(f.pageCount).toBe(304);
    expect(f.rating).toBeCloseTo(3.8947368, 5);
    expect(f.ratingCount).toBe(133);
    expect(f.publishedYear).toBe(2023);
  });

  /**
   * Measured live: the work record carries no series and no language, and its
   * ISBN list holds a different printing than the library's copy. Claiming any
   * of those would let the weakest source in the chain overwrite better data
   * wherever it happened to outrank another.
   */
  test("never claims series, language, or isbn13", () => {
    const f = mapOpenLibraryDoc(search.docs[0]);
    expect("seriesName" in f).toBe(false);
    expect("seriesPosition" in f).toBe(false);
    expect("language" in f).toBe(false);
    expect("isbn13" in f).toBe(false);
  });

  // It also must not claim a cover: cover_i needs URL construction and the
  // result is lower resolution than what Audnexus and Google Books return.
  test("never claims a cover", () => {
    expect("coverUrl" in mapOpenLibraryDoc(search.docs[0])).toBe(false);
  });

  test("returns an empty contribution for junk", () => {
    expect(mapOpenLibraryDoc(null)).toEqual({});
    expect(mapOpenLibraryDoc({})).toEqual({});
  });

  test("omits fields the doc does not carry rather than nulling them", () => {
    const f = mapOpenLibraryDoc({ title: "Bare", ratings_count: 4 });
    expect(f.ratingCount).toBe(4);
    expect("pageCount" in f).toBe(false);
    expect("rating" in f).toBe(false);
  });
});

describe("isHtmlBody", () => {
  /**
   * Measured live: /isbn/{isbn}.json answers with an HTML error page for French
   * ISBNs. Parsing that as JSON throws, and treating the throw as an outage
   * would retry a lookup that can never succeed.
   */
  test("detects an HTML body served from a JSON route", () => {
    expect(isHtmlBody('\n\n<!DOCTYPE html>\n<html lang="en">')).toBe(true);
    expect(isHtmlBody("<html>")).toBe(true);
    expect(isHtmlBody('{"key":"/works/OL1W"}')).toBe(false);
    expect(isHtmlBody("")).toBe(false);
  });
});
