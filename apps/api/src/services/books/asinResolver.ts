import { normalizeTitleForMatch } from "@rawkoon/api/utils/medias/filenameParser";
import type { AsinCandidate, AsinMatch, AsinWant } from "./types";

/**
 * ASIN resolution and — more importantly — rejection.
 *
 * Audnexus is ASIN-keyed and exposes no book title search, so every ASIN comes
 * from a freetext Audible catalog query. Nothing but this scorer stands between
 * the library and a confidently wrong record, which is worse than no record at
 * all: a wrong ASIN attaches a complete, plausible, incorrect book.
 *
 * Measured against a live catalog on 2026-08-24.
 */

export type { AsinCandidate, AsinMatch, AsinWant } from "./types";

/** Below this, no ASIN is recorded and the book keeps its Google Books data. */
export const ASIN_MIN_SCORE = 60;

const DISQUALIFIED = -1;

/**
 * Volume markers as providers actually spell them. The `\d{1,3}` bound keeps a
 * four-digit year from being read as a volume number.
 */
const VOLUME_RE =
  /\b(?:tome|tomo|volume|vol|book|livre|partie|part|t)\s*\.?\s*(\d{1,3})\b/iu;

export function extractVolumeNumber(title: string): number | null {
  const m = VOLUME_RE.exec(title);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * A candidate's volume can live in three places. Title first, then subtitle,
 * then seriesPosition — and that last fallback is what catches the observed
 * collision, where the volume-1 product's title carries no number at all.
 */
const candidateVolume = (c: AsinCandidate): number | null =>
  extractVolumeNumber(c.title) ??
  (c.subtitle ? extractVolumeNumber(c.subtitle) : null) ??
  (c.seriesPosition !== null && Number.isInteger(c.seriesPosition)
    ? c.seriesPosition
    : null);

const LANG_ALIASES: Record<string, string> = {
  french: "fr",
  français: "fr",
  english: "en",
  anglais: "en",
  german: "de",
  spanish: "es",
  italian: "it",
};

const toIso639 = (raw: string | null): string | null => {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (LANG_ALIASES[key]) return LANG_ALIASES[key];
  return /^[a-z]{2}$/.test(key) ? key : null;
};

/**
 * Edition suffixes a retailer bolts onto a title. They are noise for matching:
 * the library title "<name> - Version française" and the catalog title "<name>"
 * are the same book, and without stripping these the pair only reaches
 * containment scoring, which is not enough to clear the floor on its own.
 */
const EDITION_NOISE =
  /\b(?:version|edition|édition)\s+(?:fran[çc]aise?|originale?|english|french|integrale|intégrale)\b/giu;

/** Normalize for comparison: strip edition noise, then the shared normalizer. */
const compareTitle = (raw: string): string =>
  normalizeTitleForMatch(raw.replace(EDITION_NOISE, " "));

const authorTokens = (names: string[]): Set<string> => {
  const out = new Set<string>();
  for (const name of names) {
    for (const tok of normalizeTitleForMatch(name).split(" ")) {
      // Two-letter fragments are initials and particles; they match everything.
      if (tok.length > 2) out.add(tok);
    }
  }
  return out;
};

export function scoreAsinCandidate(
  want: AsinWant,
  candidate: AsinCandidate,
): number {
  // 1. Volume agreement. Disqualifying, not merely penalising: a "tome 2"
  // request must never resolve to the tome-1 product.
  const wantVol = extractVolumeNumber(want.title);
  const candVol = candidateVolume(candidate);
  if (wantVol !== null && candVol !== null && wantVol !== candVol) {
    return DISQUALIFIED;
  }

  // 2. Author overlap. No shared token means a different book by a different
  // person, whatever the title similarity says.
  const wantAuthors = authorTokens(want.authors);
  const candAuthors = authorTokens(candidate.authors);
  let shared = 0;
  for (const tok of wantAuthors) if (candAuthors.has(tok)) shared++;
  if (wantAuthors.size > 0 && shared === 0) return DISQUALIFIED;
  const authorScore =
    wantAuthors.size === 0 ? 0 : (shared / wantAuthors.size) * 30;

  // 3. Title. Exact normalized equality is the strong signal. Containment is
  // deliberately far weaker — containment is what causes sibling-volume
  // collisions, and on its own it must NOT clear ASIN_MIN_SCORE. Measured
  // live: "Les secrets de la femme de ménage" contains the volume-1 product
  // title "La femme de ménage", and neither title carries a volume number, so
  // the volume check above cannot save it. Only corroboration — an exact
  // title, or a confirmed volume match — should push a containment hit over
  // the floor.
  const wantTitle = compareTitle(want.title);
  const candTitle = compareTitle(candidate.title);
  let titleScore = 0;
  if (wantTitle && wantTitle === candTitle) titleScore = 50;
  else if (
    wantTitle &&
    candTitle &&
    (wantTitle.includes(candTitle) || candTitle.includes(wantTitle))
  ) {
    titleScore = 15;
  }
  if (titleScore === 0) return DISQUALIFIED;

  // 4. Language. A signal only: a French edition was observed reporting
  // "english", so gating on this loses correct matches.
  const candLang = toIso639(candidate.language);
  const langScore =
    candLang && candLang === want.language.toLowerCase() ? 10 : 0;

  const volScore = wantVol !== null && candVol === wantVol ? 10 : 0;

  return titleScore + authorScore + langScore + volScore;
}

export function pickBestAsin(
  want: AsinWant,
  candidates: AsinCandidate[],
  opts?: { minScore?: number },
): AsinMatch | null {
  const floor = opts?.minScore ?? ASIN_MIN_SCORE;
  let best: AsinMatch | null = null;
  for (const candidate of candidates) {
    const score = scoreAsinCandidate(want, candidate);
    if (score < floor) continue;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best;
}
