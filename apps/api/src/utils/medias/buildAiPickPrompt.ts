export interface AiPickRelease {
  key: string;
  title: string;
  size_bytes: number | null;
  seeders: number | null;
  score: number | null;
}

export interface AiPickMediaContext {
  title: string;
  year: number | null;
  type: string;
}

/**
 * Shared by both callers: the RSS auto-grab, where a quality profile scores
 * every candidate, and interactive search, where releases arrive unscored
 * unless the search was launched from a media page. The unscored branch is
 * load-bearing — without it the model is told to rank on a signal that is
 * absent and forbidden from using the only one it has, so it disobeys to
 * answer at all.
 *
 * Undownloadable releases are filtered in code before this is sent, so the
 * prompt no longer mentions them.
 */
export const AI_SYSTEM_PROMPT =
  "You are a media release selection assistant for a homelab. " +
  "Given a list of releases, pick the single best one. " +
  "`score` is the app's quality rating derived from the user's resolution, format, and size preferences (higher is better). " +
  "Choose in this order: " +
  "(1) discard releases with the wrong language, wrong season/episode, or a low-quality capture (CAM, TS, TELESYNC, HDCAM, WORKPRINT, SCREENER); " +
  "(2) among those remaining, pick the highest score, and do not second-guess a score from the title; " +
  "(3) if every release is unscored, rank by seeders, preferring a higher resolution and a non-capture source; " +
  "(4) break ties by seeders. " +
  "release_key MUST be exactly one of the provided keys — never invent one. " +
  'Respond ONLY with valid JSON matching: { "release_key": string, "reasoning": string }. ' +
  "In reasoning, cite the deciding factors (e.g. score and seeders), under 150 characters.";

export function buildAiPickPrompt(
  media: AiPickMediaContext,
  releases: AiPickRelease[],
): string {
  const header = `Media: ${media.title}${media.year ? ` (${media.year})` : ""} [${media.type}]`;

  const list = releases
    .map((r, i) => {
      const size =
        r.size_bytes != null
          ? `${(r.size_bytes / 1e9).toFixed(1)} GB`
          : "unknown size";
      const seeders =
        r.seeders != null ? `${r.seeders} seeders` : "unknown seeders";
      const score = r.score != null ? `score:${r.score}` : "unscored";
      return `${i + 1}. key="${r.key}" | ${r.title} | ${size} | ${seeders} | ${score}`;
    })
    .join("\n");

  return `${header}\n\nReleases:\n${list}\n\nPick the best release key and explain why in one sentence.`;
}
