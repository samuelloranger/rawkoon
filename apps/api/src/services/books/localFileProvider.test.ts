import { describe, expect, test } from "bun:test";
import { mapLocalFields } from "@rawkoon/api/services/books/localFileProvider";

describe("mapLocalFields", () => {
  /**
   * Local wins over every remote source so a tagger repair sticks. If a remote
   * source outranked the file, the next refresh would silently revert the fix
   * and the tagger would be useless.
   */
  test("contributes narrators recorded from container tags", () => {
    expect(
      mapLocalFields({
        editionNarrators: ["Laure Vidal", "Audrey Meunier"],
        ebook: null,
      }).narrators,
    ).toEqual(["Laure Vidal", "Audrey Meunier"]);
  });

  test("contributes publisher and series from epub OPF metadata", () => {
    const f = mapLocalFields({
      editionNarrators: [],
      ebook: {
        title: "Le Jardin de Verre",
        authors: ["Camille Rousseau"],
        language: "fr",
        isbn13: null,
        publisher: "Éditions Lisière",
        seriesName: "Le Jardin de Verre",
        seriesPosition: 2,
      },
    });
    expect(f.publisher).toBe("Éditions Lisière");
    expect(f.seriesName).toBe("Le Jardin de Verre");
    expect(f.seriesPosition).toBe(2);
  });

  /**
   * Keys must be ABSENT, not null. An untagged file knows nothing, and a null
   * here would blank what Audnexus supplies — which is the opposite of what
   * ranking local highest is for.
   */
  test("omits keys it knows nothing about", () => {
    const f = mapLocalFields({ editionNarrators: [], ebook: null });
    expect("narrators" in f).toBe(false);
    expect("publisher" in f).toBe(false);
    expect("seriesName" in f).toBe(false);
    expect(f).toEqual({});
  });

  // Measured on a real library: most epubs carry a publisher but no series.
  test("contributes a publisher without inventing a series", () => {
    const f = mapLocalFields({
      editionNarrators: [],
      ebook: {
        title: "Mises en Abyme",
        authors: ["Guillaume Tremblay"],
        language: "fr",
        isbn13: null,
        publisher: "Guy Saint-Jean Editeur",
        seriesName: null,
        seriesPosition: null,
      },
    });
    expect(f.publisher).toBe("Guy Saint-Jean Editeur");
    expect("seriesName" in f).toBe(false);
    expect("seriesPosition" in f).toBe(false);
  });

  test("does not contribute a title, which is the indexer search term", () => {
    const f = mapLocalFields({
      editionNarrators: [],
      ebook: {
        title: "Some Tagger's Idea Of The Title",
        authors: ["Camille Rousseau"],
        language: "fr",
        isbn13: null,
        publisher: null,
        seriesName: null,
        seriesPosition: null,
      },
    });
    expect("title" in f).toBe(false);
    expect("authors" in f).toBe(false);
  });
});
