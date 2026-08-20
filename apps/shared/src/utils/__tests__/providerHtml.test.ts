import { describe, expect, it } from "bun:test";
import {
  providerHtmlParagraphs,
  providerHtmlToText,
  sanitizeProviderHtml,
} from "../providerHtml";

/**
 * Synthetic fixture, deliberately NOT a real publisher blurb — provider
 * descriptions are copyrighted marketing copy and do not belong in a test file.
 *
 * It reproduces the structural properties observed in real Google Books
 * descriptions, which is all the sanitizer cares about: accented characters,
 * typographic apostrophes, and paragraphs separated by a double <br> rather
 * than by <p>.
 */
const PROVIDER_PROSE =
  "Le récit s’ouvre sur une salle de classe vide, un matin d’hiver très clair.<br><br>Les élèves arrivent, l’un après l’autre, et personne ne dit rien.<br><br>À la fin, la porte se referme et l’enquête commence pour de bon.";

describe("sanitizeProviderHtml — real provider content", () => {
  it("keeps the <br> tags publishers actually use", () => {
    const out = sanitizeProviderHtml(PROVIDER_PROSE);
    expect(out).toContain("<br>");
    expect(out).toContain("salle de classe");
  });

  it("leaves accented text and typographic apostrophes intact", () => {
    const out = sanitizeProviderHtml(PROVIDER_PROSE);
    expect(out).toContain("récit");
    expect(out).toContain("s’ouvre");
  });

  it("is idempotent, so sanitizing on ingest and again on render is safe", () => {
    const once = sanitizeProviderHtml(PROVIDER_PROSE);
    expect(sanitizeProviderHtml(once)).toBe(once);
  });

  it("returns empty string for null and undefined", () => {
    expect(sanitizeProviderHtml(null)).toBe("");
    expect(sanitizeProviderHtml(undefined)).toBe("");
    expect(sanitizeProviderHtml("")).toBe("");
  });
});

describe("sanitizeProviderHtml — XSS vectors", () => {
  const vectors: [string, string][] = [
    ["script tag", "<script>alert(1)</script>"],
    ["img onerror", "<img src=x onerror=alert(1)>"],
    ["svg onload", "<svg onload=alert(1)>"],
    ["anchor with javascript URL", '<a href="javascript:alert(1)">x</a>'],
    ["iframe", "<iframe src='https://evil.test'></iframe>"],
    ["event handler on an allowed tag", "<b onclick=alert(1)>bold</b>"],
    [
      "style attribute on an allowed tag",
      '<p style="position:fixed;inset:0">x</p>',
    ],
    ["encoded bracket", "&#60;script&gt;alert(1)&#60;/script&gt;"],
    ["hex encoded bracket", "&#x3c;script&#x3e;alert(1)"],
    ["double encoded", "&amp;lt;script&amp;gt;alert(1)"],
    ["mixed case script", "<ScRiPt>alert(1)</ScRiPt>"],
    ["malformed unclosed tag", "<script"],
    ["object tag", "<object data='x'></object>"],
    ["form injection", "<form action=x><input name=y>"],
    ["srcdoc", "<iframe srcdoc='<script>alert(1)</script>'>"],
    ["base tag", "<base href='https://evil.test/'>"],
    ["meta refresh", "<meta http-equiv=refresh content=0>"],
    ["link stylesheet", "<link rel=stylesheet href='https://evil.test/x.css'>"],
  ];

  it.each(vectors)("neutralizes %s", (_label, payload) => {
    const out = sanitizeProviderHtml(payload);

    // The security property is precisely this: every tag that survives must be
    // a bare, attribute-less tag from the allowlist. Anything else — a script,
    // an attribute, a URL scheme — is left as escaped text, which is inert.
    //
    // Deliberately NOT asserting that substrings like "onclick" are absent:
    // "&lt;b onclick=alert(1)&gt;" contains that substring as visible text and
    // is completely harmless. Asserting on substrings rather than on structure
    // fails correct output while proving nothing extra.
    const ALLOWED = /<\/?(?:br|p|b|strong|i|em|u|ul|ol|li|blockquote)>/g;
    const tags = out.match(/<[^>]*>/g) ?? [];
    for (const tag of tags) {
      expect(tag).toMatch(
        /^<\/?(?:br|p|b|strong|i|em|u|ul|ol|li|blockquote)>$/,
      );
    }

    // No unescaped bracket may remain once the allowlisted tags are removed.
    const withoutAllowed = out.replace(ALLOWED, "");
    expect(withoutAllowed).not.toContain("<");
    expect(withoutAllowed).not.toContain(">");
  });

  it("an attribute on an allowed tag drops the whole tag, not just the attribute", () => {
    // The tag is not repaired into a bare <b>; it stays visible text, which is
    // the honest outcome and cannot smuggle anything.
    const out = sanitizeProviderHtml("<b onclick=alert(1)>bold</b>");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;b onclick=alert(1)&gt;");
    expect(out).toContain("bold");
  });

  it("preserves the ampersand as text rather than reopening an entity", () => {
    expect(sanitizeProviderHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });
});

describe("sanitizeProviderHtml — allowlist normalization", () => {
  it.each([
    ["<br>", "<br>"],
    ["<br/>", "<br>"],
    ["<br />", "<br>"],
    ["<BR />", "<br>"],
    ["<strong>x</strong>", "<strong>x</strong>"],
    ["<em>x</em>", "<em>x</em>"],
  ])("%s → %s", (input, expected) => {
    expect(sanitizeProviderHtml(input)).toContain(expected);
  });
});

describe("providerHtmlToText", () => {
  it("strips all markup and collapses whitespace", () => {
    const out = providerHtmlToText(PROVIDER_PROSE);
    expect(out).not.toContain("<");
    expect(out).toContain("très clair. Les élèves");
  });

  it("does not run words together across block tags", () => {
    expect(providerHtmlToText("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("removes dangerous markup too", () => {
    expect(providerHtmlToText("<script>alert(1)</script>hi")).toBe(
      "alert(1)hi",
    );
  });
});

describe("providerHtmlParagraphs", () => {
  it("splits <br><br> into real paragraphs", () => {
    const paras = providerHtmlParagraphs(PROVIDER_PROSE);
    expect(paras).toHaveLength(3);
    expect(paras[0]).toContain("salle de classe");
    expect(paras[1]).toContain("élèves");
    expect(paras[2]).toContain("enquête");
  });

  it("splits <p> markup as well", () => {
    expect(providerHtmlParagraphs("<p>one</p><p>two</p>")).toEqual([
      "one",
      "two",
    ]);
  });

  it("keeps a single <br> as a line break inside one paragraph", () => {
    expect(providerHtmlParagraphs("a<br>b")).toEqual(["a<br>b"]);
  });

  it("returns an empty list for empty input", () => {
    expect(providerHtmlParagraphs(null)).toEqual([]);
    expect(providerHtmlParagraphs("   ")).toEqual([]);
  });
});
