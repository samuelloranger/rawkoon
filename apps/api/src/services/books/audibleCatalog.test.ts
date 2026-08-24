import { describe, expect, test } from "bun:test";
import {
  AUDIBLE_TLD_BY_REGION,
  mapAudibleProduct,
} from "@rawkoon/api/services/books/audibleCatalog";
import fixture from "../../../test/fixtures/bookMetadata/audible-catalog-series.json";

const products = fixture.products as unknown[];

describe("mapAudibleProduct", () => {
  test("maps a product to an AsinCandidate", () => {
    const c = mapAudibleProduct(products[0]);
    expect(c).not.toBeNull();
    expect(c?.asin).toBe("B0SCRUB001");
    expect(c?.narrators).toEqual(["Laure Vidal", "Audrey Meunier"]);
    expect(c?.seriesName).toBe("Le Jardin de Verre");
    expect(c?.seriesPosition).toBe(1);
    expect(c?.runtimeMin).toBe(578);
    expect(c?.publisher).toBe("Éditions Lisière");
    expect(c?.coverUrl).toBe("https://example.invalid/cover-1.jpg");
  });

  // The image map is keyed by pixel width; the widest is the only one worth
  // showing in a library grid.
  test("picks the widest available cover", () => {
    expect(mapAudibleProduct(products[1])?.coverUrl).toBe(
      "https://example.invalid/cover-2.jpg",
    );
  });

  // Observed live: a novella in a series carries sequence "".
  test("tolerates an empty series sequence", () => {
    const c = mapAudibleProduct(products[2]);
    expect(c?.seriesName).toBe("Le Jardin de Verre");
    expect(c?.seriesPosition).toBeNull();
  });

  /**
   * Observed live: the catalog lists translators inside `authors`, annotated in
   * the name itself. Letting one through would propagate a translator into
   * LibraryBook.authors via the book_authors trigger — which already happened
   * once with the Google Books provider.
   */
  test("drops role-annotated contributors from authors", () => {
    expect(mapAudibleProduct(products[2])?.authors).toEqual([
      "Camille Rousseau",
    ]);
  });

  test("returns null when the product has no asin or title", () => {
    expect(mapAudibleProduct({ title: "No asin" })).toBeNull();
    expect(mapAudibleProduct({ asin: "B0SCRUB009" })).toBeNull();
    expect(mapAudibleProduct(null)).toBeNull();
  });
});

describe("AUDIBLE_TLD_BY_REGION", () => {
  test("maps the regions Audnexus accepts", () => {
    expect(AUDIBLE_TLD_BY_REGION.fr).toBe("fr");
    expect(AUDIBLE_TLD_BY_REGION.us).toBe("com");
    expect(AUDIBLE_TLD_BY_REGION.uk).toBe("co.uk");
    expect(AUDIBLE_TLD_BY_REGION.ca).toBe("ca");
  });
});
