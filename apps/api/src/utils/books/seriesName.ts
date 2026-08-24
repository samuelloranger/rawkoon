/**
 * Series names arrive dirty from Audible. Shapes observed live on 2026-08-24:
 * a leading colon, a bracketed "[French Edition]" marker, and a trailing
 * parenthesized acronym.
 *
 * This deliberately does NOT reconcile a series that arrives under two
 * different names across its volumes — observed live, where volumes 1-3 and
 * 4-7 of one series carry different series names. That is a data reality on
 * the provider side; inventing a canonical name would be a guess, so both are
 * stored as given and the operator can fix it with `overrides`.
 */

/** Bracketed markers are always metadata, never part of a name. */
const BRACKETED = /\s*\[[^\]]*\]\s*/g;

/**
 * A trailing parenthesized run that is short and carries no lowercase prose is
 * an acronym or edition marker. "(LJDV)" goes; "(les années perdues)" stays.
 */
const TRAILING_ACRONYM = /\s*\(\s*[^a-z()]{1,12}\s*\)\s*$/u;

export function normalizeSeriesName(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  let out = raw.replace(BRACKETED, " ");
  out = out.replace(TRAILING_ACRONYM, " ");
  // Leading punctuation, then collapse the whitespace the strips left behind.
  out = out
    .replace(/^[\s:;,\-–—]+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return out.length > 0 ? out : null;
}

export function parseSeriesPosition(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
