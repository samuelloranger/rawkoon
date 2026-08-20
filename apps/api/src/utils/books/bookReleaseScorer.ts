import { normalizeTitleForMatch } from "@rawkoon/api/utils/medias/filenameParser";
import type { BookEditionKind, BookFormat } from "@rawkoon/shared/types";
import {
  inferEditionKind,
  parseBookReleaseTitle,
  type ParsedBookRelease,
} from "@rawkoon/api/utils/books/bookReleaseParser";

/**
 * Book release scoring and — more importantly — rejection.
 *
 * Rejection is the highest-risk unit in the whole books feature. Torznab has no
 * `isbn` or `bookid` parameter (verified against live caps: book-search
 * advertises `supportedParams="q"` only), so every book search is freetext and
 * nothing but this filter stands between the library and unrelated results.
 */

export interface BookScoreProfile {
  /** Ordered preference; first entry is best. */
  allowedFormats: string[];
  cutoffFormat: string | null;
  preferRetail: boolean;
  maxSizeMb: number | null;
  minSeeders: number;
  minAudioBitrate: number | null;
  preferredLanguages: string[];
  prioritizedTrackers: string[];
  preferTrackerOverQuality: boolean;
}

export interface BookReleaseCandidate {
  title: string;
  sizeBytes: number | null;
  seeders: number | null;
  indexer: string | null;
}

export interface BookScoreResult {
  parsed: ParsedBookRelease;
  kind: BookEditionKind | null;
  score: number;
  rejected: boolean;
  rejections: string[];
}

/** Tokens shorter than this are articles/particles and carry no signal. */
const MIN_TOKEN_LEN = 3;

const tokenize = (value: string): string[] =>
  normalizeTitleForMatch(value)
    .split(" ")
    .filter((t) => t.length >= MIN_TOKEN_LEN);

/**
 * Apostrophes appear in three spellings across trackers: kept, replaced by a
 * separator, or dropped so an elided article glues to the next word.
 * normalizeTitleForMatch turns punctuation into spaces, which handles the first
 * two but splits the third apart — and the leftover one-letter article then
 * falls under MIN_TOKEN_LEN and disappears. The same title therefore tokenized
 * one way on the library side and another on the release side, and correct
 * releases were rejected with "Title does not match".
 *
 * So tokenize both ways and let a match on either spelling count. The glued
 * variant yields a longer, more specific token, so this does not loosen
 * matching: a different title that merely shares a stem still fails on token
 * equality.
 */
const tokenVariants = (value: string): string[][] => {
  const spaced = tokenize(value);
  if (!/['\u2019`]/.test(value)) return [spaced];
  const glued = tokenize(value.replace(/['\u2019`]/g, ""));
  return glued.join(" ") === spaced.join(" ") ? [spaced] : [spaced, glued];
};

/** Every token from every spelling, for the side being searched. */
const tokenUniverse = (value: string): Set<string> =>
  new Set(tokenVariants(value).flat());

/**
 * Does the release title contain the book's title?
 *
 * Token equality, not substring. Competing translations of one work often
 * share a word stem, so a substring test accepts the wrong edition; comparing
 * whole tokens keeps them apart.
 */
export function releaseMatchesBookTitle(
  releaseTitle: string,
  bookTitle: string,
): boolean {
  const variants = tokenVariants(bookTitle).filter((v) => v.length > 0);
  if (variants.length === 0) return false;
  const have = tokenUniverse(releaseTitle);
  // Any one complete spelling of the title is enough.
  return variants.some((wanted) => wanted.every((t) => have.has(t)));
}

/**
 * Does the release name credit the author?
 *
 * Surname only. Given names get abbreviated, reordered, or dropped by
 * trackers, but the surname survives.
 */
export function releaseMatchesAuthor(
  releaseTitle: string,
  authors: string[],
): boolean {
  if (authors.length === 0) return true; // nothing to check against
  const have = tokenUniverse(releaseTitle);
  return authors.some((author) =>
    // Same apostrophe problem as titles: a surname like O'Brien is written
    // OBrien and O.Brien about as often as with the apostrophe.
    tokenVariants(author).some((parts) => {
      if (parts.length === 0) return false;
      const surname = parts[parts.length - 1];
      return have.has(surname);
    }),
  );
}

const formatRank = (format: BookFormat | null, allowed: string[]): number => {
  if (!format) return -1;
  const idx = allowed.indexOf(format);
  return idx;
};

/**
 * Score and vet one release for one edition.
 *
 * Language is scored, never filtered. Plenty of releases carry no language tag
 * at all, so rejecting untagged ones would discard genuine results.
 */
export function scoreBookRelease(
  candidate: BookReleaseCandidate,
  opts: {
    bookTitle: string;
    authors: string[];
    kind: BookEditionKind;
    profile: BookScoreProfile;
  },
): BookScoreResult {
  const { bookTitle, authors, kind, profile } = opts;
  const parsed = parseBookReleaseTitle(candidate.title);
  const inferredKind = inferEditionKind(parsed, candidate.sizeBytes);
  const rejections: string[] = [];

  if (!releaseMatchesBookTitle(candidate.title, bookTitle)) {
    rejections.push("Title does not match");
  }
  if (!releaseMatchesAuthor(candidate.title, authors)) {
    rejections.push("Author not credited in release name");
  }
  if (parsed.isPack) {
    // A "Complete Collection" cannot map to one edition. Deferred, not solved.
    rejections.push("Multi-book pack");
  }
  if (inferredKind !== null && inferredKind !== kind) {
    rejections.push(`Release is a ${inferredKind}, wanted ${kind}`);
  }
  if (inferredKind === null) {
    rejections.push("Could not determine ebook vs audiobook");
  }

  const rank = formatRank(parsed.format, profile.allowedFormats);
  if (parsed.format && profile.allowedFormats.length > 0 && rank === -1) {
    rejections.push(`Format ${parsed.format} not allowed by profile`);
  }

  const seeders = candidate.seeders ?? 0;
  if (profile.minSeeders > 0 && seeders < profile.minSeeders) {
    rejections.push(`Below ${profile.minSeeders} seeders`);
  }

  const sizeMb =
    candidate.sizeBytes != null ? candidate.sizeBytes / 1_048_576 : null;
  if (
    profile.maxSizeMb != null &&
    sizeMb != null &&
    sizeMb > profile.maxSizeMb
  ) {
    rejections.push(`Larger than ${profile.maxSizeMb} MB`);
  }

  if (
    kind === "audiobook" &&
    profile.minAudioBitrate != null &&
    parsed.audioBitrate != null &&
    parsed.audioBitrate < profile.minAudioBitrate
  ) {
    // One title can be listed anywhere from 64 to 320 kb/s, so this bites.
    rejections.push(
      `Bitrate ${parsed.audioBitrate} kbps below ${profile.minAudioBitrate}`,
    );
  }

  // ── Scoring ────────────────────────────────────────────────────────────────
  let score = 0;

  // Format preference dominates: position in allowedFormats, best first.
  if (rank >= 0) {
    score += (profile.allowedFormats.length - rank) * 1000;
  }

  if (profile.preferRetail && parsed.isRetail) score += 400;
  if (parsed.isProper) score += 150;

  if (parsed.language && profile.preferredLanguages.includes(parsed.language)) {
    score += 300;
  }

  const trackerIdx = candidate.indexer
    ? profile.prioritizedTrackers.indexOf(candidate.indexer)
    : -1;
  if (trackerIdx >= 0) {
    const trackerScore =
      (profile.prioritizedTrackers.length - trackerIdx) *
      (profile.preferTrackerOverQuality ? 2000 : 200);
    score += trackerScore;
  }

  if (kind === "audiobook" && parsed.audioBitrate != null) {
    // Diminishing: 192 is meaningfully better than 64, 320 barely better again.
    score += Math.min(300, Math.round(parsed.audioBitrate * 1.2));
  }

  // Seeders as a light tiebreaker only — never enough to outrank format.
  score += Math.min(100, seeders);

  return {
    parsed,
    kind: inferredKind,
    score,
    rejected: rejections.length > 0,
    rejections,
  };
}

export type ScoredBookRelease<T> = {
  release: T;
  result: BookScoreResult;
};

export function pickBestBookRelease<T>(
  scored: ScoredBookRelease<T>[],
): ScoredBookRelease<T> | null {
  const viable = scored.filter((s) => !s.result.rejected);
  if (viable.length === 0) return null;
  return viable.reduce((best, cur) =>
    cur.result.score > best.result.score ? cur : best,
  );
}

/**
 * Has this edition reached its profile's cutoff format? Used to stop
 * pointless upgrade searches, mirroring cutoffResolution for video.
 */
export function meetsBookCutoff(
  currentFormat: BookFormat | null,
  profile: BookScoreProfile,
): boolean {
  if (!profile.cutoffFormat || !currentFormat) return false;
  const cutoffIdx = profile.allowedFormats.indexOf(profile.cutoffFormat);
  const currentIdx = profile.allowedFormats.indexOf(currentFormat);
  if (cutoffIdx === -1 || currentIdx === -1) return false;
  // Lower index is better, so meeting the cutoff means being at or above it.
  return currentIdx <= cutoffIdx;
}
