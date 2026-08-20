/**
 * Sanitize HTML that came from a third-party metadata provider.
 *
 * Google Books descriptions contain real markup: publishers commonly separate
 * paragraphs with `<br><br>` rather than `<p>`. So the text cannot simply be
 * printed, and it equally cannot be handed to dangerouslySetInnerHTML as
 * received.
 *
 * The strategy is allowlist-by-construction rather than blocklisting:
 *
 *   1. decode entities, so `&#60;script&gt;` cannot smuggle a bracket past step 2
 *   2. escape EVERY `&`, `<`, `>` and `"` — at this point the string is inert
 *   3. restore only exact, attribute-less tags from a fixed list
 *
 * Because step 3 matches literal strings like `<br>` and `</p>` and nothing
 * else, no attribute can survive: there is no way to express `href`,
 * `onerror`, `style`, or a `javascript:` URL. Adding a tag to ALLOWED_TAGS can
 * never introduce an attribute vector, which is what makes this safe to extend.
 */

/** Attribute-less tags worth keeping. Any tag not listed becomes visible text. */
const ALLOWED_TAGS = [
  "br",
  "p",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ul",
  "ol",
  "li",
  "blockquote",
] as const;

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
};

/**
 * Decode entities first so that an encoded bracket cannot slip through the
 * escape step still looking like markup.
 */
const decodeEntities = (input: string): string => {
  let out = input;
  for (const [entity, char] of Object.entries(NAMED_ENTITIES)) {
    out = out.split(entity).join(char);
  }
  // Numeric forms, decimal and hex. Decoded here, escaped in the next step.
  out = out.replace(/&#(\d{1,7});/g, (_, d: string) => {
    const code = Number(d);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : "";
  });
  out = out.replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h: string) => {
    const code = Number.parseInt(h, 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : "";
  });
  return out;
};

const escapeAll = (input: string): string =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Restore the allowlist. Self-closing and whitespace-padded spellings are
 * normalized (`<br/>`, `<BR />` → `<br>`); everything else stays escaped.
 */
const restoreAllowedTags = (escaped: string): string => {
  let out = escaped;
  for (const tag of ALLOWED_TAGS) {
    // Opening tag, optionally self-closed, no attributes permitted.
    out = out.replace(
      new RegExp(`&lt;\\s*${tag}\\s*/?\\s*&gt;`, "gi"),
      `<${tag}>`,
    );
    // Closing tag.
    out = out.replace(
      new RegExp(`&lt;\\s*/\\s*${tag}\\s*&gt;`, "gi"),
      `</${tag}>`,
    );
  }
  return out;
};

/**
 * Returns HTML safe to pass to dangerouslySetInnerHTML.
 *
 * Applied twice on purpose: once when ingesting from the provider, so the
 * database only ever holds clean markup, and again at render time, which covers
 * rows stored before this existed. The function is idempotent, so the second
 * pass is a no-op on already-clean input.
 */
export function sanitizeProviderHtml(input: string | null | undefined): string {
  if (!input) return "";
  return restoreAllowedTags(escapeAll(decodeEntities(input)));
}

/**
 * Plain text version, for list subtitles, meta descriptions, and anywhere a
 * single unstyled line is wanted. Block-level tags become spaces so words do
 * not run together.
 */
export function providerHtmlToText(input: string | null | undefined): string {
  if (!input) return "";
  return decodeEntities(input)
    .replace(/<\s*\/?\s*(br|p|li|ul|ol|blockquote)\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split sanitized markup into paragraphs for typographic control.
 *
 * Publishers express a paragraph break as `<br><br>` about as often as `<p>`,
 * so rendering the raw string leaves prose as one wall of text with line
 * breaks in it. Splitting lets the description be set with real paragraph
 * spacing instead.
 */
export function providerHtmlParagraphs(
  input: string | null | undefined,
): string[] {
  const safe = sanitizeProviderHtml(input);
  if (!safe) return [];
  return safe
    .split(/(?:<br>\s*){2,}|<\/p>\s*<p>|<p>|<\/p>/i)
    .map((chunk) => chunk.replace(/^(?:<br>\s*)+|(?:<br>\s*)+$/gi, "").trim())
    .filter((chunk) => chunk.length > 0);
}
