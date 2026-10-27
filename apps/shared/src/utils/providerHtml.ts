/** Allowlist sanitizer for provider HTML: decode entities, escape everything, then restore only exact attribute-less tags, so no attribute vector can exist. */

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

/** Decode first so an encoded bracket can't survive the escape step as markup. */
const decodeEntities = (input: string): string => {
  let out = input;
  for (const [entity, char] of Object.entries(NAMED_ENTITIES)) {
    out = out.split(entity).join(char);
  }
  // Numeric forms, decimal and hex; escaped in the next step.
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

/** Restore allowlisted tags, normalizing spellings like `<br/>`; everything else stays escaped. */
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

/** HTML safe for dangerouslySetInnerHTML; idempotent, so it runs on ingest and again at render for older rows. */
export function sanitizeProviderHtml(input: string | null | undefined): string {
  if (!input) return "";
  return restoreAllowedTags(escapeAll(decodeEntities(input)));
}

/** Plain text for subtitles and meta descriptions; block tags become spaces. */
export function providerHtmlToText(input: string | null | undefined): string {
  if (!input) return "";
  return decodeEntities(input)
    .replace(/<\s*\/?\s*(br|p|li|ul|ol|blockquote)\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into paragraphs, since publishers use `<br><br>` as often as `<p>`. */
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
