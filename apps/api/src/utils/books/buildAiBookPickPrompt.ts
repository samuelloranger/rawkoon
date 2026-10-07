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
}

export const AI_BOOK_SYSTEM_PROMPT =
  "You are a book release selection assistant for a homelab. " +
  "Given a wanted book and a list of releases, pick the single best one. " +
  "`score` is the app's quality rating derived from the user's format, bitrate, and size preferences (higher is better). " +
  "Choose in this order: " +
  "(1) discard releases for the wrong title, the wrong volume of a series (e.g. tome 2 when tome 1 is wanted), or the wrong author; " +
  "(2) discard releases of the wrong kind (an ebook when an audiobook is wanted, or the reverse) or in a different language than the edition's; " +
  "(3) discard abridged, summary, sample, or excerpt releases; " +
  "(4) among those remaining, pick the highest score, and do not second-guess a score from the title; " +
  "(5) break ties by seeders. " +
  "release_key MUST be exactly one of the provided keys — never invent one. " +
  'Respond ONLY with valid JSON matching: { "release_key": string, "reasoning": string }. ' +
  "In reasoning, cite the deciding factors (e.g. score and seeders), under 150 characters.";

export function buildAiBookPickPrompt(
  book: AiBookPickContext,
  releases: AiBookPickRelease[],
): string {
  const series = book.seriesName
    ? ` | Series: ${book.seriesName}${book.seriesPosition != null ? ` #${book.seriesPosition}` : ""}`
    : "";
  const header =
    `Book: ${book.title}${series} | Author: ${book.authors.join(", ") || "unknown"}` +
    ` | Wanted: ${book.kind} | Language: ${book.language}`;

  const list = releases
    .map((r, i) => {
      const size =
        r.size_bytes != null
          ? `${(r.size_bytes / 1e9).toFixed(1)} GB`
          : "unknown size";
      const seeders =
        r.seeders != null ? `${r.seeders} seeders` : "unknown seeders";
      const score = r.score != null ? `score:${r.score}` : "unscored";
      const traits = [
        `format:${r.format ?? "unknown"}`,
        `kind:${r.kind ?? "unknown"}`,
        `language:${r.language ?? "unknown"}`,
        ...(r.audio_bitrate != null ? [`bitrate:${r.audio_bitrate}kbps`] : []),
      ].join(" ");
      return `${i + 1}. key="${r.key}" | ${r.title} | ${size} | ${seeders} | ${score} | ${traits}`;
    })
    .join("\n");

  return `${header}\n\nReleases:\n${list}\n\nPick the best release key and explain why in one sentence.`;
}
