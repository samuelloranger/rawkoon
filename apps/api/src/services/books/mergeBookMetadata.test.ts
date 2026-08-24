import { describe, expect, test } from "bun:test";
import { mergeBookMetadata } from "@rawkoon/api/services/books/mergeBookMetadata";
import type { BookMetadataSource } from "@rawkoon/shared/types";

const ORDER: BookMetadataSource[] = [
  "local",
  "audnexus",
  "googlebooks",
  "openlibrary",
];

describe("mergeBookMetadata", () => {
  test("takes each field from the highest-priority source that has it", () => {
    const { merged, provenance } = mergeBookMetadata(
      [
        {
          source: "googlebooks",
          fields: { overview: "google blurb", pageCount: 1 },
        },
        {
          source: "audnexus",
          fields: { overview: "audnexus blurb", narrators: ["Laure Vidal"] },
        },
        { source: "openlibrary", fields: { pageCount: 304 } },
      ],
      ORDER,
      null,
    );
    expect(merged.overview).toBe("audnexus blurb");
    expect(merged.narrators).toEqual(["Laure Vidal"]);
    // googlebooks outranks openlibrary, so its pageCount wins even though
    // openlibrary is the field's usual supplier.
    expect(merged.pageCount).toBe(1);
    expect(provenance.overview).toBe("audnexus");
    expect(provenance.pageCount).toBe("googlebooks");
  });

  /**
   * The distinction the whole contract rests on. An absent key means "nothing
   * to say"; null means "asserts empty". Without it, a high-priority source
   * that simply lacks a field would blank what a lower one knows.
   */
  test("an absent key defers, an explicit null wins", () => {
    const deferred = mergeBookMetadata(
      [
        { source: "audnexus", fields: {} },
        { source: "googlebooks", fields: { publisher: "Éditions Lisière" } },
      ],
      ORDER,
      null,
    );
    expect(deferred.merged.publisher).toBe("Éditions Lisière");
    expect(deferred.provenance.publisher).toBe("googlebooks");

    const asserted = mergeBookMetadata(
      [
        { source: "audnexus", fields: { publisher: null } },
        { source: "googlebooks", fields: { publisher: "Éditions Lisière" } },
      ],
      ORDER,
      null,
    );
    expect(asserted.merged.publisher).toBeNull();
    expect(asserted.provenance.publisher).toBe("audnexus");
  });

  /**
   * Every provider builds its arrays by filtering, so `[]` is
   * indistinguishable from "this payload had no such list" and must not blank a
   * lower source's value. Measured live: a book with no series still carries a
   * genres array from one source and none from another.
   */
  test("an empty array is nothing to say, not an assertion of emptiness", () => {
    const { merged, provenance } = mergeBookMetadata(
      [
        { source: "audnexus", fields: { genres: [] } },
        { source: "googlebooks", fields: { genres: ["Thriller"] } },
      ],
      ORDER,
      null,
    );
    expect(merged.genres).toEqual(["Thriller"]);
    expect(provenance.genres).toBe("googlebooks");
  });

  test("takes the winning source's array whole rather than unioning", () => {
    const { merged } = mergeBookMetadata(
      [
        { source: "audnexus", fields: { genres: ["Policier et suspense"] } },
        { source: "openlibrary", fields: { genres: ["Thriller", "Mystery"] } },
      ],
      ORDER,
      null,
    );
    // Unioning across a French taxonomy and an English one yields a bilingual
    // mess, so the winner's array is taken whole.
    expect(merged.genres).toEqual(["Policier et suspense"]);
  });

  test("a source absent from the order is ignored entirely", () => {
    const { merged, provenance } = mergeBookMetadata(
      [{ source: "audnexus", fields: { narrators: ["Laure Vidal"] } }],
      ["local", "googlebooks"],
      null,
    );
    expect(merged.narrators).toBeUndefined();
    expect(provenance.narrators).toBeUndefined();
  });

  test("overrides beat every source and are excluded from provenance", () => {
    const { merged, provenance } = mergeBookMetadata(
      [{ source: "local", fields: { seriesName: "Le Jardin de Verre" } }],
      ORDER,
      { seriesName: "Chroniques du Verre" },
    );
    expect(merged.seriesName).toBe("Chroniques du Verre");
    // An overridden field has no source: the operator is the source.
    expect(provenance.seriesName).toBeUndefined();
  });

  test("ignores override keys that are not mergeable fields", () => {
    const { merged } = mergeBookMetadata([], ORDER, {
      seriesName: "Ok",
      nonsense: 1,
    });
    expect(merged.seriesName).toBe("Ok");
    expect("nonsense" in merged).toBe(false);
  });

  // The overrides column is operator-supplied JSON, so a crafted __proto__ key
  // must not reach Object.prototype.
  test("a crafted __proto__ override key cannot pollute the prototype", () => {
    const overrides = JSON.parse('{"__proto__": {"polluted": true}}') as Record<
      string,
      unknown
    >;
    mergeBookMetadata([], ORDER, overrides);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("the internal __asin carrier never reaches the merged output", () => {
    const { merged, provenance } = mergeBookMetadata(
      [{ source: "audnexus", fields: { __asin: "B0SCRUB001", rating: 4.6 } }],
      ORDER,
      null,
    );
    expect(merged.rating).toBe(4.6);
    expect("__asin" in merged).toBe(false);
    expect(provenance.__asin).toBeUndefined();
  });

  test("returns empty results for no candidates", () => {
    const { merged, provenance } = mergeBookMetadata([], ORDER, null);
    expect(merged).toEqual({});
    expect(provenance).toEqual({});
  });
});
