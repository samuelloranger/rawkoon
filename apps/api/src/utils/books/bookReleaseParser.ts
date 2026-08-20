import type {
  AudiobookFormat,
  BookEditionKind,
  BookFormat,
  EbookFormat,
} from "@rawkoon/shared/types";

/**
 * Book release title parser.
 *
 * Deliberately NOT an extension of filenameParser.parseReleaseTitle: that
 * parser's regexes misfire badly on book titles, reading `M4B` as `MP4` and a
 * four-digit year as a resolution. Two parsers, two test suites, no
 * cross-contamination.
 *
 * The cases handled below are drawn from what real book indexers return:
 * French-locale bitrate notation, scene-style dot separators alongside spaced
 * ones, en dashes, inconsistent format casing, and a "no group" placeholder
 * suffix. See the test file for the concrete shapes.
 */

const EBOOK_FORMATS: EbookFormat[] = ["epub", "azw3", "mobi", "pdf", "cbz"];
const AUDIO_FORMATS: AudiobookFormat[] = ["m4b", "mp3", "flac", "ogg"];

export const isAudiobookFormat = (f: BookFormat): f is AudiobookFormat =>
  (AUDIO_FORMATS as string[]).includes(f);

export const kindForFormat = (f: BookFormat): BookEditionKind =>
  isAudiobookFormat(f) ? "audiobook" : "ebook";

export interface ParsedBookRelease {
  format: BookFormat | null;
  kind: BookEditionKind | null;
  /** kb/s. Handles both `[MP3 à 64 kb/s]` and `[MP3.192kbps]`. */
  audioBitrate: number | null;
  /** ISO 639-1, when the title carries a language tag at all. */
  language: string | null;
  releaseGroup: string | null;
  /**
   * True only on a positive retail signal. Most releases carry no marker at
   * all, which is why there is no `requireRetail` profile field — requiring
   * one would reject nearly every genuine result.
   */
  isRetail: boolean;
  isProper: boolean;
  /** "Complete Collection"-style bundles; rejected, not imported. */
  isPack: boolean;
}

/**
 * Normalize separators before matching. Release names mix `-`, en dash `–`,
 * dots, and runs of spaces, including doubled ones.
 */
const normalize = (title: string): string =>
  title
    .replace(/[‐-―]/g, "-") // all dash variants → hyphen
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const LANGUAGE_PATTERNS: [RegExp, string][] = [
  [/\b(?:fr|fre|fra|french|francais|français|vf|vff|multi-fr)\b/i, "fr"],
  [/\b(?:en|eng|english)\b/i, "en"],
  [/\b(?:es|spa|spanish|espanol|español)\b/i, "es"],
  [/\b(?:de|ger|deu|german|allemand)\b/i, "de"],
  [/\b(?:it|ita|italian)\b/i, "it"],
  [/\b(?:pt|por|portuguese)\b/i, "pt"],
  [/\b(?:nl|dut|nld|dutch)\b/i, "nl"],
];

/**
 * `-NOTAG` (and friends) is a tracker convention meaning "no group", not a
 * group literally called NOTAG. Treating it as a group name would let it
 * leak into file names and custom-format matching.
 */
const NON_GROUPS = new Set([
  "notag",
  "nogroup",
  "nogrp",
  "none",
  "unknown",
  "na",
]);

const RETAIL_RE =
  /\b(?:retail|officiel{1,2}e?|official|kindle|kobo|audible|libro\.?fm)\b/i;
const PROPER_RE = /\b(?:proper|repack|corrig(?:e|é)|fixed|v2)\b/i;
const PACK_RE =
  /\b(?:complete|int(?:e|é)grale?|collection|anthologie|anthology|omnibus|series|saga|tomes?\s*\d+\s*(?:-|to|a|à)\s*\d+|books?\s*\d+\s*-\s*\d+|pack)\b/i;

/** Extract the audio bitrate. Both `à 64 kb/s` and `.192kbps` spellings occur. */
const parseBitrate = (normalized: string): number | null => {
  const m = normalized.match(/(\d{2,4})\s*(?:kbps|kb\/s|kbit\/s|k)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 16 || n > 2000) return null;
  return n;
};

const parseFormat = (normalized: string): BookFormat | null => {
  // Longest-first so azw3 wins over a hypothetical azw, and m4b is never
  // reached by an mp4-ish pattern.
  const ordered: BookFormat[] = [
    "azw3",
    "epub",
    "mobi",
    "flac",
    "m4b",
    "mp3",
    "ogg",
    "cbz",
    "pdf",
  ];
  for (const f of ordered) {
    if (new RegExp(`\\b${f}\\b`, "i").test(normalized)) return f;
  }
  return null;
};

const parseGroup = (rawTitle: string): string | null => {
  // Groups appear as a trailing `-GROUP`, after any bracketed section.
  const m = rawTitle.match(/-\s*([A-Za-z0-9._]{2,20})\s*$/);
  if (!m) return null;
  const candidate = m[1].replace(/[._]+$/, "");
  if (!candidate) return null;
  if (NON_GROUPS.has(candidate.toLowerCase())) return null;
  // A bare year is not a group: release names often end "- Author - 2025".
  if (/^\d{4}$/.test(candidate)) return null;
  return candidate;
};

const parseLanguage = (normalized: string): string | null => {
  // Strip bracketed format/bitrate blocks first: `[MP3 à 64 kb/s]` contains no
  // language, but a bare `a` or `s` could otherwise trip a short pattern.
  const stripped = normalized.replace(/\[[^\]]*\]/g, " ");
  for (const [re, code] of LANGUAGE_PATTERNS) {
    if (re.test(stripped)) return code;
  }
  return null;
};

export function parseBookReleaseTitle(title: string): ParsedBookRelease {
  const raw = title ?? "";
  const normalized = normalize(raw);
  const format = parseFormat(normalized);

  return {
    format,
    kind: format ? kindForFormat(format) : null,
    audioBitrate: parseBitrate(normalized),
    language: parseLanguage(normalized),
    releaseGroup: parseGroup(raw.trim()),
    isRetail: RETAIL_RE.test(normalized),
    isProper: PROPER_RE.test(normalized),
    isPack: PACK_RE.test(normalized),
  };
}

/**
 * Derive the edition kind for a release.
 *
 * Category is NOT usable for this: trackers file audiobooks under 7000 (Books)
 * as well as 3000 (Audio). Format is authoritative when present; size is the
 * fallback, and it separates the two cleanly, since ebooks run to a few MB and
 * audiobooks to hundreds.
 */
export function inferEditionKind(
  parsed: ParsedBookRelease,
  sizeBytes: number | null,
): BookEditionKind | null {
  if (parsed.kind) return parsed.kind;
  if (sizeBytes == null || sizeBytes <= 0) return null;
  const mb = sizeBytes / 1_048_576;
  if (mb <= 50) return "ebook";
  if (mb >= 100) return "audiobook";
  return null;
}

export { EBOOK_FORMATS, AUDIO_FORMATS };
