import { describe, expect, test } from "bun:test";
import { parseOpfMetadata } from "@rawkoon/api/utils/books/ebookMetadata";

/**
 * OPF parsing, exercised directly rather than through a real epub, so the
 * cases are readable. Shapes come from Calibre-written OPF, which is what a
 * Calibre-managed library on disk actually contains.
 */

const opf = (inner: string) => `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${inner}
  </metadata>
</package>`;

describe("parseOpfMetadata", () => {
  test("reads the fields the previous parser already handled", () => {
    const m = parseOpfMetadata(
      opf(`    <dc:title>Le Jardin de Verre</dc:title>
    <dc:creator opf:role="aut">Camille Rousseau</dc:creator>
    <dc:language>fra</dc:language>
    <dc:identifier scheme="ISBN">978-2-8246-3716-7</dc:identifier>`),
    );
    expect(m.title).toBe("Le Jardin de Verre");
    expect(m.authors).toEqual(["Camille Rousseau"]);
    expect(m.language).toBe("fr");
    expect(m.isbn13).toBe("9782824637167");
  });

  test("reads the publisher", () => {
    expect(
      parseOpfMetadata(opf(`    <dc:publisher>Éditions Lisière</dc:publisher>`))
        .publisher,
    ).toBe("Éditions Lisière");
  });

  /**
   * Calibre stores series as <meta> attributes, not as an element with text, so
   * tagText cannot see them.
   */
  test("reads Calibre series name and index", () => {
    const m = parseOpfMetadata(
      opf(`    <meta name="calibre:series" content="Le Jardin de Verre"/>
    <meta name="calibre:series_index" content="2"/>`),
    );
    expect(m.seriesName).toBe("Le Jardin de Verre");
    expect(m.seriesPosition).toBe(2);
  });

  // Calibre writes half-volumes as fractional indices.
  test("keeps a fractional series index", () => {
    expect(
      parseOpfMetadata(
        opf(`    <meta name="calibre:series_index" content="4.5"/>`),
      ).seriesPosition,
    ).toBe(4.5);
  });

  test("tolerates reversed attribute order and single quotes", () => {
    const m = parseOpfMetadata(
      opf(`    <meta content='Le Jardin de Verre' name='calibre:series'/>`),
    );
    expect(m.seriesName).toBe("Le Jardin de Verre");
  });

  // The series name is run through the shared normalizer, so a Calibre field
  // carrying an edition marker is cleaned the same way a provider's is.
  test("normalizes a dirty series name", () => {
    expect(
      parseOpfMetadata(
        opf(
          `    <meta name="calibre:series" content="The Glasshouse Series [French Edition]"/>`,
        ),
      ).seriesName,
    ).toBe("The Glasshouse Series");
  });

  test("returns nulls for metadata that is absent", () => {
    const m = parseOpfMetadata(opf(`    <dc:title>Bare</dc:title>`));
    expect(m.publisher).toBeNull();
    expect(m.seriesName).toBeNull();
    expect(m.seriesPosition).toBeNull();
  });
});
