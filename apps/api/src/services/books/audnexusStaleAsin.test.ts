import { afterEach, describe, expect, test } from "bun:test";
import { AudnexusProvider } from "@rawkoon/api/services/books/audnexusProvider";
import type { BookMatchInput } from "@rawkoon/api/services/books/types";

/**
 * Recovery from a stale ASIN.
 *
 * ASINs are regional and `book_external_ids` stores no region alongside them,
 * so changing the configured region strands every book that had already
 * resolved: the stored id 404s in the new region forever. Without a retry the
 * book can never recover, because enrich returns empty and resolveAsin is
 * never reached.
 *
 * `fetch` is stubbed rather than mocked at module level so the provider's real
 * control flow runs.
 */

const BASE = "https://audnexus.test";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const book: BookMatchInput = {
  bookId: 1,
  title: "Le Jardin de Verre",
  authors: ["Camille Rousseau"],
  language: "fr",
  isbn13: null,
  googleVolumeId: "GV1",
  externalIds: { audnexus: "B0STALE001" },
};

const audnexusBook = (asin: string) => ({
  asin,
  title: "Le Jardin de Verre",
  authors: [{ asin: "B0AUTH", name: "Camille Rousseau" }],
  narrators: [{ name: "Laure Vidal" }],
  seriesPrimary: { asin: "B0SER", name: "Le Jardin de Verre", position: "1" },
  genres: [{ name: "Policier", type: "genre" }],
  language: "french",
  publisherName: "Éditions Lisière",
  releaseDate: "2024-06-27T00:00:00.000Z",
  runtimeLengthMin: 578,
  rating: "4.6",
  image: "https://example.invalid/c.jpg",
  summary: "<p>Blurb.</p>",
});

const audibleProduct = (asin: string) => ({
  products: [
    {
      asin,
      title: "Le Jardin de Verre",
      authors: [{ name: "Camille Rousseau" }],
      narrators: [{ name: "Laure Vidal" }],
      series: [{ title: "Le Jardin de Verre", sequence: "1" }],
      language: "french",
      product_images: { "500": "https://example.invalid/c.jpg" },
    },
  ],
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Record every URL requested so the control flow itself can be asserted. */
function stubFetch(handler: (url: string) => Response): string[] {
  const seen: string[] = [];
  globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input.toString();
    seen.push(url);
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return seen;
}

describe("AudnexusProvider.enrich with a stored ASIN", () => {
  test("uses the stored ASIN and does not search when it resolves", async () => {
    const seen = stubFetch((url) => {
      if (url.includes("/books/B0STALE001"))
        return json(audnexusBook("B0STALE001"));
      return json({}, 500);
    });

    const fields = await new AudnexusProvider(BASE, "fr").enrich(book);

    expect(fields.narrators).toEqual(["Laure Vidal"]);
    expect(fields.__asin).toBe("B0STALE001");
    expect(seen.some((u) => u.includes("audible"))).toBe(false);
  });

  /**
   * The regression: the stored id is unknown in this region, so the provider
   * must fall through to a fresh catalogue search instead of giving up.
   */
  test("re-resolves when the stored ASIN is unknown in this region", async () => {
    const seen = stubFetch((url) => {
      if (url.includes("/books/B0STALE001")) return json({}, 404);
      if (url.includes("api.audible."))
        return json(audibleProduct("B0FRESH002"));
      if (url.includes("/books/B0FRESH002"))
        return json(audnexusBook("B0FRESH002"));
      return json({}, 500);
    });

    const fields = await new AudnexusProvider(BASE, "fr").enrich(book);

    expect(fields.narrators).toEqual(["Laure Vidal"]);
    // The replacement id travels back, so the caller overwrites the stale row.
    expect(fields.__asin).toBe("B0FRESH002");
    expect(seen.some((u) => u.includes("api.audible."))).toBe(true);
  });

  test("gives up quietly when re-resolution finds the same dead ASIN", async () => {
    stubFetch((url) => {
      if (url.includes("/books/B0STALE001")) return json({}, 404);
      if (url.includes("api.audible."))
        return json(audibleProduct("B0STALE001"));
      return json({}, 500);
    });

    // Returning the stale id again would otherwise loop straight back into the
    // fetch that just 404'd.
    expect(await new AudnexusProvider(BASE, "fr").enrich(book)).toEqual({});
  });

  test("contributes nothing when the catalogue has no match at all", async () => {
    stubFetch((url) => {
      if (url.includes("/books/B0STALE001")) return json({}, 404);
      if (url.includes("api.audible.")) return json({ products: [] });
      return json({}, 500);
    });

    expect(await new AudnexusProvider(BASE, "fr").enrich(book)).toEqual({});
  });
});
