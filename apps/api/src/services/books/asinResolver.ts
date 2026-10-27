import { normalizeTitleForMatch } from "@rawkoon/api/utils/medias/filenameParser";
import type { AsinCandidate, AsinMatch, AsinWant } from "./types";

/** Audnexus has no title search, so ASINs come from freetext catalog queries and this scorer must reject confidently wrong matches. */

export type { AsinCandidate, AsinMatch, AsinWant } from "./types";

/** Below this, no ASIN is recorded and the book keeps its Google Books data. */
export const ASIN_MIN_SCORE = 60;

/** Sized to sink an exact-title, full-author match (80) on a language mismatch, yet leave an exact-volume match (90) at the floor. */
const LANGUAGE_MISMATCH_PENALTY = 30;

const DISQUALIFIED = -1;

/** Volume markers as providers spell them; the 1-3 digit bound keeps a year from reading as a volume. */
const VOLUME_RE =
  /\b(?:tome|tomo|volume|vol|book|livre|partie|part|t)\s*\.?\s*(\d{1,3})\b/iu;

export function extractVolumeNumber(title: string): number | null {
  const m = VOLUME_RE.exec(title);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Volume can be in title, subtitle or seriesPosition; the last catches a volume-1 title with no number. */
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

/** Language claimed by an explicit edition marker, which outranks the retailer's unreliable language tag. */
const EDITION_LANGUAGE: Array<[RegExp, string]> = [
  [/\b(?:version|[ée]dition)\s+fran[çc]aise?\b/iu, "fr"],
  [/\bfrench\s+edition\b/iu, "fr"],
  [/\b(?:version|[ée]dition)\s+anglaise?\b/iu, "en"],
  [/\benglish\s+edition\b/iu, "en"],
];

const editionLanguage = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  for (const [re, lang] of EDITION_LANGUAGE) {
    if (re.test(raw)) return lang;
  }
  return null;
};

/** Whether a product is another language edition; shared with the stored-ASIN path, and a marker on the library title suppresses the verdict. */
export function languagesDisagree(
  want: { title: string; language: string },
  candidate: {
    title: string;
    subtitle?: string | null;
    language?: string | null;
  },
): boolean {
  const wantLang = want.language.toLowerCase();
  if (editionLanguage(want.title) === wantLang) return false;
  const candLang =
    editionLanguage(candidate.title) ??
    editionLanguage(candidate.subtitle) ??
    toIso639(candidate.language ?? null);
  return candLang !== null && candLang !== wantLang;
}

/** Retailer edition suffixes, in both word orders; left in, a genuine French edition scored under the floor. */
const EDITION_NOISE =
  /\b(?:(?:version|edition|édition)\s+(?:fran[çc]aise?|originale?|english|french|integrale|intégrale)|(?:fran[çc]aise?|english|french|original)\s+(?:version|edition|édition))\b/giu;

/** Normalize for comparison: strip edition noise, then the shared normalizer. */
const compareTitle = (raw: string): string =>
  normalizeTitleForMatch(raw.replace(EDITION_NOISE, " "));

const authorTokens = (names: string[]): Set<string> => {
  const out = new Set<string>();
  for (const name of names) {
    for (const tok of normalizeTitleForMatch(name).split(" ")) {
      if (tok.length > 2) out.add(tok);
    }
  }
  return out;
};

export function scoreAsinCandidate(
  want: AsinWant,
  candidate: AsinCandidate,
): number {
  // 1. Volume mismatch disqualifies: a tome 2 request must never resolve to the tome-1 product.
  const wantVol = extractVolumeNumber(want.title);
  const candVol = candidateVolume(candidate);
  if (wantVol !== null && candVol !== null && wantVol !== candVol) {
    return DISQUALIFIED;
  }

  // 2. No shared author token means a different book, whatever the title similarity.
  const wantAuthors = authorTokens(want.authors);
  const candAuthors = authorTokens(candidate.authors);
  let shared = 0;
  for (const tok of wantAuthors) if (candAuthors.has(tok)) shared++;
  if (wantAuthors.size > 0 && shared === 0) return DISQUALIFIED;
  const authorScore =
    wantAuthors.size === 0 ? 0 : (shared / wantAuthors.size) * 30;

  // 3. Containment alone must not clear ASIN_MIN_SCORE (it causes sibling-volume collisions); only an exact title or volume match corroborates it.
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

  // 4. Language is a penalty, not a gate (editions get mislabelled), and a marker on the library title suppresses it.
  const wantLang = want.language.toLowerCase();
  const candLang =
    editionLanguage(candidate.title) ??
    editionLanguage(candidate.subtitle) ??
    toIso639(candidate.language);
  let langScore = 0;
  if (candLang === wantLang) langScore = 10;
  else if (languagesDisagree(want, candidate)) {
    langScore = -LANGUAGE_MISMATCH_PENALTY;
  }

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
