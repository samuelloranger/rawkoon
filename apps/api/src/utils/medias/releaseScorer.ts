import {
  type ParsedRelease,
  parseAudioFlags,
} from "@rawkoon/api/utils/medias/filenameParser";
import type {
  AssignedCustomFormat,
  RejectionReason,
  ReleaseEvalContext,
  ScoreBreakdown,
  ScoreComponent,
} from "@rawkoon/api/utils/medias/customFormatTypes";
import { formatMatches } from "@rawkoon/api/utils/medias/customFormatEvaluator";
import { languageFamilyOf } from "@rawkoon/shared/utils/languageFamily";
import { parseReleaseStructure } from "@rawkoon/shared/utils/releaseStructure";

export interface QualityProfileScoreInput {
  minResolution: number;
  /** Hard ceiling — releases above this resolution are rejected. null = no ceiling. */
  cutoffResolution: number | null;
  preferredSources: string[];
  preferredCodecs: string[];
  /** e.g. VFF, VF2, en — matched via parseAudioFlags on the release title */
  preferredLanguages: string[];
  /** Ordered list of indexer names — earlier = higher bonus. */
  prioritizedTrackers: string[];
  /**
   * When true, the tracker bonus (~1500/1000/500) overrides resolution/source
   * preference. When false, it acts as a tie-breaker only (~300/200/100).
   */
  preferTrackerOverQuality: boolean;
  maxSizeGb: number | null;
  requireHdr: boolean;
  preferHdr: boolean;
  /** Built-in dead-torrent guard. 0 = off. Rejects when seeders < minSeeders (null seeders never rejected). */
  minSeeders: number;
  /** Custom formats assigned to this profile (with per-profile score + gates). */
  customFormats: AssignedCustomFormat[];
}

const RES_RANK: Record<number, number> = {
  480: 1,
  720: 2,
  1080: 3,
  2160: 4,
};

function resolutionRank(r: ParsedRelease["resolution"]): number | null {
  if (r == null) return null;
  const v = RES_RANK[r];
  return v === undefined ? null : v;
}

function minResolutionRank(minRes: number): number | null {
  const v = RES_RANK[minRes];
  return v === undefined ? null : v;
}

const DISC_SOURCES = [
  "bluray",
  "blu-ray",
  "bdrip",
  "brrip",
  "remux",
  "bdremux",
  "hdlight",
];
const WEB_SOURCES = ["web", "web-dl", "webdl", "webrip", "hdrip"];

/**
 * Parsed sources each preference accepts. Deliberately one-way: preferring
 * BluRay accepts a remux off the same disc, but preferring REMUX must not
 * accept a plain BluRay — otherwise ranking REMUX above BluRay is a no-op.
 */
const SOURCE_ACCEPTS: Record<string, string[]> = {
  remux: ["remux", "bdremux"],
  bdremux: ["remux", "bdremux"],
  bluray: DISC_SOURCES,
  "blu-ray": DISC_SOURCES,
  hdlight: ["hdlight"],
  // Scene rules spell an untouched stream plain "WEB"; it is a WEB-DL, never a WEBRip.
  "web-dl": ["web-dl", "webdl", "web"],
  webdl: ["web-dl", "webdl", "web"],
  webrip: ["webrip", "hdrip"],
  hdrip: ["hdrip"],
  web: WEB_SOURCES,
  hdtv: ["hdtv"],
  dvdrip: ["dvdrip", "dvd"],
};

function parsedSourceMatchesPreferred(
  parsed: string | null,
  preferred: string,
): boolean {
  if (!parsed) return false;
  const p = parsed.trim().toLowerCase();
  const pref = preferred.trim().toLowerCase();
  const accepts = SOURCE_ACCEPTS[pref];
  return accepts ? accepts.includes(p) : pref === p;
}

// HEVC/x265 and AVC/x264 are the same codec under different names
const CODEC_ALIASES: Record<string, string[]> = {
  hevc: ["hevc", "x265", "h265", "h.265"],
  x265: ["hevc", "x265", "h265", "h.265"],
  avc: ["avc", "x264", "h264", "h.264"],
  x264: ["avc", "x264", "h264", "h.264"],
};

function codecMatches(pref: string, parsed: string): boolean {
  const p = pref.toLowerCase();
  const c = parsed.toLowerCase();
  const aliases = CODEC_ALIASES[p];
  return aliases ? aliases.includes(c) : p === c;
}

function indexScore(index: number, base: number, step = 100): number {
  if (index < 0) return 0;
  return Math.max(0, base - index * step);
}

/** One audio-rank step is worth one source-rank step, so neither language nor image quality wins outright. */
const RANK_STEP = 200;

/**
 * Index of the first preferred language the release's audio meets, or -1.
 * Original French audio (VOF/VOQ) has no dub to choose from, so it meets the
 * profile's first French preference.
 */
export function preferredLanguageIndex(
  rawTitle: string,
  preferred: readonly string[],
): number {
  const flags = new Set(parseAudioFlags(rawTitle).map((f) => f.toLowerCase()));
  const originalFrench = flags.has("vof") || flags.has("voq");
  return preferred.findIndex((p) => {
    const pref = p.trim().toLowerCase();
    return (
      flags.has(pref) || (originalFrench && languageFamilyOf(pref) === "fr")
    );
  });
}

function languagePreferenceScore(title: string, preferred: string[]): number {
  if (!preferred.length) return 0;
  const idx = preferredLanguageIndex(title, preferred);
  return idx < 0 ? 0 : (preferred.length - 1 - idx) * RANK_STEP;
}

/**
 * Size (GB) at which a movie or a single episode stops gaining visible quality
 * for its resolution; past it each extra GB costs points.
 */
const SIZE_SWEET_SPOT_GB: Record<
  "movie" | "episode",
  Record<number, number>
> = {
  movie: { 480: 2, 720: 4, 1080: 8, 2160: 25 },
  episode: { 480: 0.6, 720: 1.2, 1080: 2.5, 2160: 8 },
};

/** Below this share of the sweet spot an encode is starved. */
const STARVED_RATIO = 0.15;
const STARVED_PENALTY = -300;
/** Points lost per 100% over the sweet spot, capped. */
const OVERSIZE_PENALTY_PER_RATIO = 400;
const MAX_OVERSIZE_PENALTY = -800;

export type SizeFit = "small" | "ok" | "large" | "bloated";

/**
 * How a release's size sits against the sweet spot for its resolution, per
 * movie or per episode. Null when it can't be judged: unknown size or
 * resolution, or a pack whose episode count the title doesn't give.
 */
export function releaseSizeFit(
  rawTitle: string,
  resolution: number | null,
  sizeBytes: number | null,
): { fit: SizeFit; penalty: number } | null {
  if (sizeBytes == null || sizeBytes <= 0 || resolution == null) return null;
  const structure = parseReleaseStructure(rawTitle);
  if (structure.completeSeries) return null;
  const isTv = structure.season != null || structure.airDate != null;
  // shortcut: a season pack names no episode count, so it's not judged; upgrade when packs carry one.
  if (isTv && structure.episodes.length === 0 && !structure.airDate)
    return null;
  const perItem = isTv ? Math.max(1, structure.episodes.length) : 1;
  const sweet = SIZE_SWEET_SPOT_GB[isTv ? "episode" : "movie"][resolution];
  if (sweet == null) return null;

  const ratio = sizeBytes / perItem / 1e9 / sweet;
  if (ratio < STARVED_RATIO) return { fit: "small", penalty: STARVED_PENALTY };
  if (ratio <= 1) return { fit: "ok", penalty: 0 };
  const penalty = Math.max(
    MAX_OVERSIZE_PENALTY,
    -Math.round((ratio - 1) * OVERSIZE_PENALTY_PER_RATIO),
  );
  return { fit: ratio <= 2 ? "large" : "bloated", penalty };
}

const rankOf = (index: number): number | null => (index < 0 ? null : index + 1);

/** 1-based position of a release in each of the profile's ranked lists (null when unlisted), matched exactly as scoring matches them. */
export function profileRanks(
  rawTitle: string,
  parsed: ParsedRelease,
  profile: QualityProfileScoreInput,
): { language: number | null; source: number | null; codec: number | null } {
  return {
    language: rankOf(
      preferredLanguageIndex(rawTitle, profile.preferredLanguages),
    ),
    source: rankOf(
      profile.preferredSources.findIndex((p) =>
        parsedSourceMatchesPreferred(parsed.source, p),
      ),
    ),
    codec: rankOf(
      profile.preferredCodecs.findIndex((p) =>
        parsed.codec ? codecMatches(p, parsed.codec) : false,
      ),
    ),
  };
}

export function scoreReleaseDetailed(
  ctx: ReleaseEvalContext,
  profile: QualityProfileScoreInput,
): ScoreBreakdown {
  const { parsed, sizeBytes, indexerName, seeders, freeleech } = ctx;
  const reasons: RejectionReason[] = [];

  const pr = resolutionRank(parsed.resolution);
  const minR = minResolutionRank(profile.minResolution);
  if (minR == null || pr == null) {
    reasons.push({ code: "resolution_below_min" });
  } else if (pr < minR) {
    reasons.push({
      code: "resolution_below_min",
      params: { min: profile.minResolution },
    });
  } else if (profile.cutoffResolution != null) {
    const cutoffR = minResolutionRank(profile.cutoffResolution);
    if (cutoffR != null && pr > cutoffR) {
      reasons.push({
        code: "resolution_above_cutoff",
        params: { cutoff: profile.cutoffResolution },
      });
    }
  }

  if (profile.requireHdr && !parsed.hdr)
    reasons.push({ code: "hdr_required_absent" });

  if (profile.preferredLanguages.length > 0) {
    if (preferredLanguageIndex(ctx.rawTitle, profile.preferredLanguages) < 0)
      reasons.push({ code: "language_no_match" });
  }

  if (
    profile.maxSizeGb != null &&
    sizeBytes != null &&
    sizeBytes > profile.maxSizeGb * 1e9
  ) {
    reasons.push({
      code: "size_over_cap",
      params: { cap_gb: profile.maxSizeGb },
    });
  }

  if (parsed.isSample) reasons.push({ code: "is_sample" });

  // Built-in minSeeders gate — null seeders is treated as unknown (never rejected).
  if (
    profile.minSeeders > 0 &&
    seeders != null &&
    seeders < profile.minSeeders
  ) {
    reasons.push({
      code: "seeders_below_min",
      params: { min: profile.minSeeders, got: seeders },
    });
  }

  // Evaluate each format ONCE (keyed by identity, not name — avoids double work
  // and name-collision bugs), then reuse for gates and scoring below.
  const formatMatchResults = new Map<AssignedCustomFormat, boolean>(
    profile.customFormats.map((fmt) => [fmt, formatMatches(fmt, ctx)]),
  );
  const matchedFormats: string[] = profile.customFormats
    .filter((fmt) => formatMatchResults.get(fmt))
    .map((fmt) => fmt.name);
  for (const fmt of profile.customFormats) {
    const matched = formatMatchResults.get(fmt) ?? false;
    if (fmt.required && !matched)
      reasons.push({
        code: "custom_format_required_absent",
        params: { name: fmt.name },
      });
    if (fmt.forbidden && matched)
      reasons.push({
        code: "custom_format_forbidden_present",
        params: { name: fmt.name },
      });
  }

  if (reasons.length > 0) return { rejected: true, reasons };

  // Only non-zero contributors are recorded. A component absent from the
  // breakdown means it contributed 0 (e.g. resolution exactly at the profile
  // minimum), not that it was skipped.
  const components: ScoreComponent[] = [];
  const add = (
    code: ScoreComponent["code"],
    value: number,
    params?: ScoreComponent["params"],
  ) => {
    if (value !== 0)
      components.push({ code, value, ...(params ? { params } : {}) });
  };

  const tierDelta = pr! - minR!;
  add("resolution_tier", tierDelta * 1000, { tier: tierDelta });

  const srcIdx = profile.preferredSources.findIndex((pref) =>
    parsedSourceMatchesPreferred(parsed.source, pref),
  );
  // 800/200 keeps all five source options distinct while staying under one
  // resolution tier (1000), so source rank never outranks resolution.
  add("preferred_source", indexScore(srcIdx, 800, RANK_STEP));

  const codecIdx = profile.preferredCodecs.findIndex((pref) =>
    parsed.codec ? codecMatches(pref, parsed.codec) : false,
  );
  add("preferred_codec", indexScore(codecIdx, 200));

  add(
    "language_match",
    languagePreferenceScore(ctx.rawTitle, profile.preferredLanguages),
  );

  if (profile.preferHdr && parsed.hdr) add("prefer_hdr", 100);
  if (parsed.isProper) add("proper_repack", 150);
  if (freeleech) add("freeleech", 200);

  // A preferred source covers a 4 GB encode and a 40 GB remux alike, so size is judged for every release.
  add(
    "size_penalty",
    releaseSizeFit(ctx.rawTitle, parsed.resolution, sizeBytes)?.penalty ?? 0,
  );

  if (indexerName && profile.prioritizedTrackers.length > 0) {
    const trackerIdx = profile.prioritizedTrackers.findIndex(
      (t) => t.toLowerCase() === indexerName.toLowerCase(),
    );
    if (trackerIdx >= 0) {
      const base = profile.preferTrackerOverQuality ? 1500 : 300;
      add("tracker_priority", indexScore(trackerIdx, base));
    }
  }

  for (const fmt of profile.customFormats) {
    if (formatMatchResults.get(fmt))
      add("custom_format", fmt.score, { name: fmt.name });
  }

  const total = components.reduce((sum, c) => sum + c.value, 0);
  return { rejected: false, total, components, matchedFormats };
}

/**
 * Score a parsed release against a quality profile.
 * @param releaseTitleForFlags raw indexer title (used for parseAudioFlags / language bonus)
 * @param indexerName name of the Prowlarr indexer (used for tracker priority bonus)
 * @returns a numeric score on success, or a non-empty string[] listing the stable rejection
 *   CODES (not localized prose — the FE translates them) when the release is rejected.
 */
export function scoreRelease(
  parsed: ParsedRelease,
  profile: QualityProfileScoreInput,
  sizeBytes: number | null,
  releaseTitleForFlags?: string | null,
  indexerName?: string | null,
  freeleech?: boolean,
  seeders?: number | null,
): number | string[] {
  const breakdown = scoreReleaseDetailed(
    {
      parsed,
      rawTitle: releaseTitleForFlags ?? "",
      sizeBytes,
      indexerName: indexerName ?? null,
      seeders: seeders ?? null,
      freeleech: Boolean(freeleech),
    },
    profile,
  );
  return breakdown.rejected
    ? breakdown.reasons.map((r) => r.code)
    : breakdown.total;
}
