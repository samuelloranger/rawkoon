import { describe, expect, test } from "bun:test";
import {
  pickBookForIsbn,
  pinQueriedIsbn,
} from "@rawkoon/api/services/books/googleBooksProvider";
import type { ProviderBook } from "@rawkoon/api/services/books/types";

/**
 * Google's `isbn:` search returns related editions of the same work. Taking
 * results[0] with maxResults=1 is what turned a French Lumen ISBN into the
 * English Tor volume. Selection must prefer the volume that actually carries
 * the queried identifier.
 */

const book = (
  partial: Partial<ProviderBook> & Pick<ProviderBook, "volumeId" | "title">,
): ProviderBook => ({
  subtitle: null,
  authors: ["V. E. Schwab"],
  language: "en",
  publishedYear: 2018,
  isbn13: null,
  coverUrl: null,
  overview: null,
  seriesName: null,
  seriesPosition: null,
  ...partial,
});

describe("pickBookForIsbn", () => {
  const frenchIsbn = "9782371022508";
  const englishIsbn = "9781250303554";

  test("prefers the volume whose isbn13 is the queried ISBN", () => {
    const english = book({
      volumeId: "en-first",
      title: "Vengeful",
      language: "en",
      isbn13: englishIsbn,
    });
    const french = book({
      volumeId: "fr-lumen",
      title: "Vengeful",
      language: "fr",
      isbn13: frenchIsbn,
    });

    // English is first — the bug that shipped.
    expect(pickBookForIsbn([english, french], frenchIsbn)?.volumeId).toBe(
      "fr-lumen",
    );
  });

  test("tolerates hyphens in the query", () => {
    const french = book({
      volumeId: "fr-lumen",
      title: "Vengeful",
      language: "fr",
      isbn13: frenchIsbn,
    });
    expect(pickBookForIsbn([french], "978-2-37102-250-8")?.volumeId).toBe(
      "fr-lumen",
    );
  });

  test("when no volume carries the ISBN, prefers the registration-group language", () => {
    // 978-2 → French. Neither hit has the exact ISBN (Google sometimes
    // returns sibling editions only), so language is the next best signal.
    const english = book({
      volumeId: "en",
      title: "Vengeful",
      language: "en",
      isbn13: englishIsbn,
    });
    const french = book({
      volumeId: "fr",
      title: "Vengeful",
      language: "fr",
      isbn13: "9782371022515",
    });
    expect(pickBookForIsbn([english, french], frenchIsbn)?.volumeId).toBe("fr");
  });

  test("returns null for an empty candidate list", () => {
    expect(pickBookForIsbn([], frenchIsbn)).toBeNull();
  });

  test("returns null for a non-ISBN query", () => {
    expect(
      pickBookForIsbn(
        [book({ volumeId: "x", title: "Vengeful", isbn13: frenchIsbn })],
        "not-an-isbn",
      ),
    ).toBeNull();
  });
});

describe("pinQueriedIsbn", () => {
  /**
   * The operator typed a specific ISBN. Whatever volume Google handed back,
   * the stored isbn13 must be that one — not a sibling edition's identifier
   * that happened to be listed first on the volume record.
   */
  test("overwrites isbn13 with the queried ISBN-13", () => {
    const english = book({
      volumeId: "en-first",
      title: "Vengeful",
      language: "en",
      isbn13: "9781250303554",
    });
    const pinned = pinQueriedIsbn(english, "9782371022508");
    expect(pinned.isbn13).toBe("9782371022508");
    // Language must follow the ISBN the operator actually asked for.
    expect(pinned.language).toBe("fr");
  });
});
