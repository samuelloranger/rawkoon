import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  palmaresCoverUrl,
  parsePalmaresHtml,
  parseProductDetails,
} from "@rawkoon/api/services/books/leslibrairesPalmares";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

describe("parsePalmaresHtml", () => {
  it("parses the full general palmarès in rank order", () => {
    const entries = parsePalmaresHtml(fixture("palmares-general.html"));
    expect(entries.length).toBe(20);
    expect(entries[0]).toEqual({
      rank: 1,
      title: "C'était ça ou mourir",
      isbn13: "9782764629253",
      url: "https://www.leslibraires.ca/livres/c-etait-ca-ou-mourir-9782764629253",
      coverUrl: palmaresCoverUrl("9782764629253"),
      // Product-page fields are filled later, in getPalmares — not by the parser.
      author: null,
      overview: null,
      publishedYear: null,
    });
    const ranks = entries.map((e) => e.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  // Regression: jeunesse product URLs end in `-<isbn>.html`, general ones in
  // `-<isbn>?utm…`. An ISBN regex anchored on `?`/`/`/end silently dropped every
  // `.html` URL, yielding one entry instead of twenty.
  it("parses ISBNs from .html-suffixed URLs (jeunesse)", () => {
    const entries = parsePalmaresHtml(fixture("palmares-jeunesse.html"));
    expect(entries.length).toBe(20);
    for (const e of entries) expect(e.isbn13).toMatch(/^\d{13}$/);
    expect(entries[0].title).toBe("Un livre à cinq sous");
    expect(entries[0].isbn13).toBe("9782898431838");
  });

  it("strips tracking query params from the product URL", () => {
    const entries = parsePalmaresHtml(fixture("palmares-general.html"));
    for (const e of entries) expect(e.url).not.toContain("?");
  });

  it("returns an empty list for markup with no ItemList", () => {
    expect(parsePalmaresHtml("<html><body>no data</body></html>")).toEqual([]);
  });

  it("ignores non-ItemList JSON-LD blocks", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "LocalBusiness",
      name: "Les libraires",
    })}</script>`;
    expect(parsePalmaresHtml(html)).toEqual([]);
  });
});

describe("parseProductDetails", () => {
  it("reads author, synopsis, cover and year from the Product/Book JSON-LD", () => {
    const d = parseProductDetails(fixture("leslibraires-product.html"));
    expect(d.author).toBe("Françoise Ega");
    expect(d.overview).toContain("roman d'apprentissage");
    expect(d.coverUrl).toBe(
      "https://images.leslibraires.ca/books/9782898331947/front/9782898331947_large.webp",
    );
    expect(d.publishedYear).toBe(2025);
  });

  it("returns nulls when there is no Book block", () => {
    expect(parseProductDetails("<html></html>")).toEqual({
      author: null,
      overview: null,
      coverUrl: null,
      publishedYear: null,
    });
  });
});

describe("palmaresCoverUrl", () => {
  it("builds the CDN url with the requested size", () => {
    expect(palmaresCoverUrl("9782764629253")).toBe(
      "https://images.leslibraires.ca/books/9782764629253/front/9782764629253_medium.webp",
    );
    expect(palmaresCoverUrl("9782764629253", "small")).toBe(
      "https://images.leslibraires.ca/books/9782764629253/front/9782764629253_small.webp",
    );
  });
});
