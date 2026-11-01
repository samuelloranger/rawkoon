import { formatMatches } from "@rawkoon/api/utils/medias/customFormatEvaluator";
import type { AssignedCustomFormat } from "@rawkoon/api/utils/medias/customFormatTypes";
import {
  parseAudioFlags,
  parseReleaseSeasonEpisode,
  parseReleaseTitle,
} from "@rawkoon/api/utils/medias/filenameParser";
import {
  profileRanks,
  type QualityProfileScoreInput,
} from "@rawkoon/api/utils/medias/releaseScorer";

export interface AiPickRelease {
  key: string;
  title: string;
  size_bytes: number | null;
  seeders: number | null;
  /** Classic score; only orders the shortlist, never shown to the model. */
  score: number | null;
  indexer?: string | null;
  freeleech?: boolean;
}

export interface AiPickMediaContext {
  title: string;
  year: number | null;
  type: string;
  /** The media's quality profile, sent as preferences in place of the classic score. */
  profile?: QualityProfileScoreInput | null;
  season?: number | null;
  episode?: number | null;
}

function targetLabel(season?: number | null, episode?: number | null) {
  if (season == null) return null;
  const s = `S${String(season).padStart(2, "0")}`;
  return episode == null
    ? `${s} (season pack)`
    : `${s}E${String(episode).padStart(2, "0")}`;
}

/**
 * Shared by the RSS auto-grab, the add-time search and interactive search.
 * The model judges each release's parsed traits against the user's profile
 * rather than reading the classic score, which reduced it to a seeder
 * tie-breaker. The grab paths enforce hard profile rules (minimum resolution,
 * size cap, required formats) in code before this is sent.
 */
export const AI_SYSTEM_PROMPT =
  "You are a media release selection assistant for a homelab. " +
  "Given a list of releases, pick the single best one. " +
  "Each release lists traits parsed from its name; trust them over your own reading of the title. " +
  "A (#N) after a trait is its position in the user's ranked list for that trait: #1 is the first choice, a lower number always beats a higher one, and (-) means not in the list. " +
  "Choose in this order: " +
  "(1) discard releases marked WRONG-EPISODE and low-quality captures (CAM, TS, TELESYNC, HDCAM, WORKPRINT, SCREENER); " +
  "(2) the audio rank outranks every quality trait: the lowest audio (#N) wins even if its source or codec is worse, and any (#N) beats (-); " +
  "(3) only between releases with the same audio rank: higher resolution up to the cutoff, then the lowest src (#N), then the lowest codec (#N), then HDR if preferred, then releases matching liked formats over disliked ones; " +
  "if the profile says trackers outrank quality, prefer the earliest listed tracker first; " +
  "(4) without a profile, prefer higher resolution and a WEB or BluRay source; " +
  "(5) between releases of the same quality, prefer a PROPER/REPACK, then more seeders; " +
  "avoid a release with very few seeders when a comparable one is well seeded. " +
  "release_key MUST be exactly one of the provided keys — never invent one. " +
  'Respond ONLY with valid JSON matching: { "release_key": string, "reasoning": string }. ' +
  "In reasoning, cite the deciding traits (e.g. language, resolution, source, size), under 150 characters.";

const ordered = (values: string[]) => values.join(" > ");

/** Format names repeat on every release row, so a large profile would crowd a small model's context. */
const MAX_FORMAT_NAMES = 5;

const strongestFormats = (formats: AssignedCustomFormat[]): string[] =>
  [...formats]
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, MAX_FORMAT_NAMES)
    .map((f) => f.name);

function profileLines(profile: QualityProfileScoreInput): string[] {
  const { minResolution: min, cutoffResolution: cutoff } = profile;
  const res =
    cutoff == null
      ? `${min}p+`
      : cutoff === min
        ? `${min}p only`
        : `${min}p-${cutoff}p`;
  const liked = strongestFormats(
    profile.customFormats.filter((f) => f.score > 0),
  );
  const disliked = strongestFormats(
    profile.customFormats.filter((f) => f.score < 0),
  );
  return [
    profile.preferredLanguages.length
      ? `Preferred audio languages: ${profile.preferredLanguages.join(", ")}`
      : null,
    `Resolution: ${res}`,
    profile.preferredSources.length
      ? `Sources: ${ordered(profile.preferredSources)}`
      : null,
    profile.preferredCodecs.length
      ? `Codecs: ${ordered(profile.preferredCodecs)}`
      : null,
    profile.preferHdr ? "HDR: preferred" : null,
    profile.maxSizeGb != null ? `Size cap: ${profile.maxSizeGb} GB` : null,
    profile.prioritizedTrackers.length
      ? `Trackers: ${ordered(profile.prioritizedTrackers)}${
          profile.preferTrackerOverQuality ? " (outrank quality)" : ""
        }`
      : null,
    liked.length ? `Liked formats: ${liked.join(", ")}` : null,
    disliked.length ? `Disliked formats: ${disliked.join(", ")}` : null,
  ].filter((l) => l != null);
}

const ranked = (
  trait: string,
  rank: number | null,
  list: string[] | undefined,
): string =>
  list?.length ? `${trait}(${rank != null ? `#${rank}` : "-"})` : trait;

/** Small models skip the target rule when a wrong episode is otherwise the best release, so mismatches are named in code. */
function episodeTrait(title: string, media: AiPickMediaContext): string | null {
  if (media.season == null) return null;
  const parsed = parseReleaseSeasonEpisode(title);
  if (!parsed) return null;
  const wrong =
    parsed.season !== media.season ||
    (media.episode != null &&
      parsed.episode != null &&
      parsed.episode !== media.episode);
  return wrong ? "WRONG-EPISODE" : null;
}

function releaseTraits(r: AiPickRelease, media: AiPickMediaContext): string {
  const { profile } = media;
  const parsed = parseReleaseTitle(r.title);
  const audio = parseAudioFlags(r.title);
  const ranks = profile ? profileRanks(r.title, parsed, profile) : null;
  const formats = profile
    ? profile.customFormats
        .filter((f) =>
          formatMatches(f, {
            parsed,
            rawTitle: r.title,
            sizeBytes: r.size_bytes,
            indexerName: r.indexer ?? null,
            seeders: r.seeders,
            freeleech: r.freeleech ?? false,
          }),
        )
        .map((f) => f.name)
        .slice(0, MAX_FORMAT_NAMES)
    : [];
  return [
    episodeTrait(r.title, media),
    `res:${parsed.resolution != null ? `${parsed.resolution}p` : "?"}`,
    ranked(
      `src:${parsed.source ?? "?"}`,
      ranks?.source ?? null,
      profile?.preferredSources,
    ),
    ranked(
      `codec:${parsed.codec ?? "?"}`,
      ranks?.codec ?? null,
      profile?.preferredCodecs,
    ),
    parsed.hdr ? `hdr:${parsed.hdr}` : null,
    ranked(
      `audio:${audio.length ? audio.join("+") : "untagged"}`,
      ranks?.language ?? null,
      profile?.preferredLanguages,
    ),
    parsed.isProper ? "proper" : null,
    r.indexer ? `tracker:${r.indexer}` : null,
    r.freeleech ? "freeleech" : null,
    formats.length ? `formats:${formats.join(",")}` : null,
  ]
    .filter((t) => t != null)
    .join(" ");
}

export function buildAiPickPrompt(
  media: AiPickMediaContext,
  releases: AiPickRelease[],
): string {
  const target = targetLabel(media.season, media.episode);
  const header = [
    `Media: ${media.title}${media.year ? ` (${media.year})` : ""} [${media.type}]`,
    target ? `Target: ${target}` : null,
    ...(media.profile ? profileLines(media.profile) : []),
  ]
    .filter((l) => l != null)
    .join("\n");

  const list = releases
    .map((r, i) => {
      const size =
        r.size_bytes != null
          ? `${(r.size_bytes / 1e9).toFixed(1)} GB`
          : "unknown size";
      const seeders =
        r.seeders != null ? `${r.seeders} seeders` : "unknown seeders";
      return `${i + 1}. key="${r.key}" | ${r.title} | ${size} | ${seeders} | ${releaseTraits(r, media)}`;
    })
    .join("\n");

  return `${header}\n\nReleases:\n${list}\n\nPick the best release key and explain why in one sentence.`;
}
