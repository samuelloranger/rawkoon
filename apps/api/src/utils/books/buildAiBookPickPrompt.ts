import { parseBookReleaseTitle } from "@rawkoon/api/utils/books/bookReleaseParser";
import type { BookScoreProfile } from "@rawkoon/api/utils/books/bookReleaseScorer";
import type { AiPickRelease } from "@rawkoon/api/utils/medias/buildAiPickPrompt";

export interface AiBookPickRelease extends AiPickRelease {
  format: string | null;
  kind: string | null;
  language: string | null;
  audio_bitrate: number | null;
}

export interface AiBookPickContext {
  title: string;
  authors: string[];
  kind: "audiobook" | "ebook";
  language: string;
  seriesName: string | null;
  seriesPosition: number | null;
  /** The edition's profile, sent as preferences in place of the classic score. */
  profile?: BookScoreProfile | null;
}

export const AI_BOOK_SYSTEM_PROMPT =
  "You are a book release selection assistant for a homelab. " +
  "Given a wanted book and a list of releases, pick the single best one. " +
  "Each release lists traits parsed from its name; trust them over your own reading of the title. " +
  "A (#N) after a trait is its position in the user's ranked list for that trait: #1 is the first choice, a lower number always beats a higher one, and (-) means not in the list. " +
  "Choose in this order: " +
  "(1) discard releases for the wrong title, the wrong volume of a series (e.g. tome 2 when tome 1 is wanted), or the wrong author; " +
  "(2) discard releases of the wrong kind (an ebook when an audiobook is wanted, or the reverse) or clearly in a different language than the edition's; a release whose language is unknown is not a mismatch; " +
  "(3) discard abridged, summary, sample, or excerpt releases; " +
  "(4) among those remaining, the lowest format (#N) wins, even over a higher bitrate; then retail if preferred, then the lowest language (#N); " +
  "if the profile says trackers outrank quality, prefer the earliest listed tracker first; " +
  "(5) only between audiobooks of the same format, prefer a higher bitrate, though above 192 kbps it matters little; " +
  "(6) break remaining ties with a PROPER/REPACK, then more seeders; " +
  "avoid a release with very few seeders when a comparable one is well seeded. " +
  "release_key MUST be exactly one of the provided keys — never invent one. " +
  'Respond ONLY with valid JSON matching: { "release_key": string, "reasoning": string }. ' +
  "In reasoning, cite the deciding traits (e.g. format, bitrate, retail, seeders), under 150 characters.";

const ordered = (values: string[]) => values.join(" > ");

/** Small models cannot place a value in a ranked list reliably, so the position is computed here. */
const ranked = (
  trait: string,
  value: string | null,
  list: string[] | undefined,
): string => {
  if (!list?.length) return trait;
  const index = value == null ? -1 : list.indexOf(value);
  return `${trait}(${index < 0 ? "-" : `#${index + 1}`})`;
};

function profileLines(profile: BookScoreProfile): string[] {
  return [
    profile.allowedFormats.length
      ? `Formats: ${ordered(profile.allowedFormats)}`
      : null,
    profile.preferRetail ? "Retail: preferred" : null,
    profile.preferredLanguages.length
      ? `Preferred languages: ${profile.preferredLanguages.join(", ")}`
      : null,
    profile.maxSizeMb != null ? `Size cap: ${profile.maxSizeMb} MB` : null,
    profile.prioritizedTrackers.length
      ? `Trackers: ${ordered(profile.prioritizedTrackers)}${
          profile.preferTrackerOverQuality ? " (outrank quality)" : ""
        }`
      : null,
  ].filter((l) => l != null);
}

export function buildAiBookPickPrompt(
  book: AiBookPickContext,
  releases: AiBookPickRelease[],
): string {
  const series = book.seriesName
    ? ` | Series: ${book.seriesName}${book.seriesPosition != null ? ` #${book.seriesPosition}` : ""}`
    : "";
  const header = [
    `Book: ${book.title}${series} | Author: ${book.authors.join(", ") || "unknown"}` +
      ` | Wanted: ${book.kind} | Language: ${book.language}`,
    ...(book.profile ? profileLines(book.profile) : []),
  ].join("\n");

  const list = releases
    .map((r, i) => {
      const size =
        r.size_bytes != null
          ? `${(r.size_bytes / 1e9).toFixed(1)} GB`
          : "unknown size";
      const seeders =
        r.seeders != null ? `${r.seeders} seeders` : "unknown seeders";
      const parsed = parseBookReleaseTitle(r.title);
      const traits = [
        ranked(
          `format:${r.format ?? "unknown"}`,
          r.format,
          book.profile?.allowedFormats,
        ),
        `kind:${r.kind ?? "unknown"}`,
        ranked(
          `language:${r.language ?? "unknown"}`,
          r.language,
          book.profile?.preferredLanguages,
        ),
        r.audio_bitrate != null ? `bitrate:${r.audio_bitrate}kbps` : null,
        parsed.isRetail ? "retail" : null,
        parsed.isProper ? "proper" : null,
        r.indexer ? `tracker:${r.indexer}` : null,
      ]
        .filter((t) => t != null)
        .join(" ");
      return `${i + 1}. key="${r.key}" | ${r.title} | ${size} | ${seeders} | ${traits}`;
    })
    .join("\n");

  return `${header}\n\nReleases:\n${list}\n\nPick the best release key and explain why in one sentence.`;
}
