import { describe, expect, test } from "bun:test";
import {
  dedupeAudnexusAuthors,
  mapAudnexusAuthor,
  mapAudnexusBook,
} from "@rawkoon/api/services/books/audnexusProvider";
import book from "../../../test/fixtures/bookMetadata/audnexus-book.json";
import authorEmpty from "../../../test/fixtures/bookMetadata/audnexus-author-empty-description.json";
import authorDupes from "../../../test/fixtures/bookMetadata/audnexus-author-search-duplicates.json";

describe("mapAudnexusBook", () => {
  test("maps the fields Google Books leaves empty", () => {
    const f = mapAudnexusBook(book);
    expect(f.narrators).toEqual(["Laure Vidal", "Audrey Meunier"]);
    expect(f.seriesName).toBe("Le Jardin de Verre");
    expect(f.seriesPosition).toBe(1);
    expect(f.publisher).toBe("Éditions Lisière");
    expect(f.coverUrl).toBe("https://example.invalid/cover-large.jpg");
    expect(f.publishedDate).toBe("2024-06-27T00:00:00.000Z");
    expect(f.publishedYear).toBe(2024);
    expect(f.isbn13).toBe("9791036631573");
  });

  // `rating` arrives as a string.
  test("coerces the string rating to a number", () => {
    expect(mapAudnexusBook(book).rating).toBe(4.6);
  });

  // Audible's taxonomy splits `genre` from `tag`. Both are genres to us, but
  // they arrive in one array and the type must not leak into the value.
  test("flattens genres and tags to names", () => {
    expect(mapAudnexusBook(book).genres).toEqual([
      "Policier et suspense",
      "Littérature et fiction",
      "Thrillers",
    ]);
  });

  // Audnexus reports a language word, not ISO 639-1.
  test("converts the language word to ISO 639-1", () => {
    expect(mapAudnexusBook(book).language).toBe("fr");
  });

  /**
   * `summary` is HTML, `description` is plain. The database only ever holds
   * sanitized HTML, matching what the Google Books provider already does.
   */
  test("prefers the HTML summary, sanitized", () => {
    const overview = mapAudnexusBook(book).overview ?? "";
    expect(overview).toContain("Chaque jour");
    expect(overview).not.toContain("<script");
  });

  test("returns an empty contribution for junk input", () => {
    expect(mapAudnexusBook(null)).toEqual({});
    expect(mapAudnexusBook({ asin: "B0SCRUB001" })).toEqual({});
    expect(mapAudnexusBook({ title: "no asin" })).toEqual({});
  });
});

describe("mapAudnexusAuthor", () => {
  test("carries the author image", () => {
    expect(mapAudnexusAuthor(authorEmpty).authorImageUrl).toBe(
      "https://example.invalid/author.jpg",
    );
  });

  /**
   * An empty description is missing data, not an assertion of emptiness, so the
   * key must be ABSENT — otherwise it would blank a bio another source knows,
   * and the region fallback would have nothing to detect.
   */
  test("omits an empty author bio rather than asserting null", () => {
    expect("authorBio" in mapAudnexusAuthor(authorEmpty)).toBe(false);
  });

  test("returns an empty contribution for junk", () => {
    expect(mapAudnexusAuthor(null)).toEqual({});
    expect(mapAudnexusAuthor({ description: "no asin" })).toEqual({});
  });
});

describe("dedupeAudnexusAuthors", () => {
  // Observed live: ten identical rows for one ASIN.
  test("collapses duplicate rows by ASIN, preserving order", () => {
    expect(dedupeAudnexusAuthors(authorDupes)).toEqual([
      { asin: "B0SCRUBA01", name: "Camille Rousseau" },
      { asin: "B0SCRUBB02", name: "Jonathan Rousseau" },
      { asin: "B0SCRUBC03", name: "Renée Rousseau-Blais" },
    ]);
  });

  test("returns an empty list for junk", () => {
    expect(dedupeAudnexusAuthors(null)).toEqual([]);
    expect(dedupeAudnexusAuthors([{ name: "no asin" }])).toEqual([]);
  });
});
