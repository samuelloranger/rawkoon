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

function sourceAliases(source: string): string[] {
  const u = source.trim();
  const lower = u.toLowerCase();
  const set = new Set<string>([u, lower]);
  if (lower === "remux" || lower === "bdremux") {
    set.add("REMUX");
    set.add("BluRay");
    set.add("bluray");
  }
  if (lower === "bluray" || lower === "blu-ray") {
    set.add("BluRay");
    set.add("BDRip");
  }
  // HDLight: French compressed-BluRay re-encode — treated as BluRay equivalent for preference matching
  if (lower === "hdlight") {
    set.add("HDLight");
    set.add("BluRay");
    set.add("bluray");
  }
  if (lower === "web-dl" || lower === "webdl") {
    set.add("WEB-DL");
    set.add("WEBDL");
  }
  if (lower === "webrip") {
    set.add("WEBRip");
  }
  // HDRip: generic re-encode from HD source — mapped to WEBRip tier
  if (lower === "hdrip") {
    set.add("HDRip");
    set.add("WEBRip");
  }
  if (lower === "web") {
    set.add("WEB");
    set.add("WEB-DL");
    set.add("WEBRip");
  }
  return [...set];
}

function parsedSourceMatchesPreferred(
  parsed: string | null,
  preferred: string,
): boolean {
  if (!parsed) return false;
  const pAli = sourceAliases(parsed);
  const prefAli = sourceAliases(preferred);
  for (const a of pAli) {
    for (const b of prefAli) {
      if (a.toLowerCase() === b.toLowerCase()) return true;
    }
  }
  return false;
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

function indexScore(index: number, base: number): number {
  if (index < 0) return 0;
  return Math.max(0, base - index * 100);
}

function languagePreferenceScore(title: string, preferred: string[]): number {
  if (!preferred.length) return 0;
  const flags = new Set(parseAudioFlags(title).map((f) => f.toLowerCase()));
  const idx = preferred.findIndex((p) => flags.has(p.trim().toLowerCase()));
  return indexScore(idx, 300);
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
    const flags = new Set(
      parseAudioFlags(ctx.rawTitle).map((f) => f.toLowerCase()),
    );
    const hasMatch = profile.preferredLanguages.some((p) =>
      flags.has(p.trim().toLowerCase()),
    );
    if (!hasMatch) reasons.push({ code: "language_no_match" });
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
  add("preferred_source", indexScore(srcIdx, 500));

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

  if (profile.maxSizeGb == null && sizeBytes != null) {
    const gb = sizeBytes / 1e9;
    if (gb > 10) add("size_penalty", -Math.floor(gb - 10) * 50);
  }

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
