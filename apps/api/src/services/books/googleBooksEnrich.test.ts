import { afterEach, describe, expect, mock, test } from "bun:test";

/**
 * Google Books must not overwrite an ISBN the book already has.
 *
 * A volume record lists one ISBN_13 as primary and it is regularly a sibling
 * printing's, so contributing it walked the operator's typed identifier away on
 * the very next refresh — including the refresh the add itself triggers.
 *
 * `fetch` is stubbed rather than the provider mocked, so the real enrich runs.
 */

mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: () => Promise.resolve(null),
  setJsonCache: () => Promise.resolve(),
}));

const { GoogleBooksProvider } = await import(
  "@rawkoon/api/services/books/googleBooksProvider"
);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The English volume, carrying the English printing's ISBN_13. */
const volume = {
  id: "EN-VOLUME",
  volumeInfo: {
    title: "Vengeful",
    authors: ["V. E. Schwab"],
    language: "en",
    publishedDate: "2018-09-25",
    industryIdentifiers: [{ type: "ISBN_13", identifier: "9781250303554" }],
  },
};

const stubVolume = () => {
  globalThis.fetch = ((_input: Parameters<typeof fetch>[0]) =>
    Promise.resolve(
      new Response(JSON.stringify(volume), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof fetch;
};

const input = (isbn13: string | null) => ({
  bookId: 1,
  title: "Vengeful",
  authors: ["V. E. Schwab"],
  language: "fr",
  isbn13,
  googleVolumeId: "EN-VOLUME",
  externalIds: {},
});

describe("GoogleBooksProvider.enrich", () => {
  test("says nothing about isbn13 when the book already has one", async () => {
    stubVolume();
    const fields = await new GoogleBooksProvider("k", "US").enrich(
      input("9782371022508"),
    );
    // Absent, not null: absent defers, null would assert emptiness.
    expect("isbn13" in fields).toBe(false);
    expect(fields.title).toBe("Vengeful");
  });

  test("fills an empty isbn13", async () => {
    stubVolume();
    const fields = await new GoogleBooksProvider("k", "US").enrich(input(null));
    expect(fields.isbn13).toBe("9781250303554");
  });
});
