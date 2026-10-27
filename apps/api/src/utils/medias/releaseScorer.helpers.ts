import type { ParsedRelease } from "@rawkoon/api/utils/medias/filenameParser";
import type { QualityProfileScoreInput } from "@rawkoon/api/utils/medias/releaseScorer";

/** Returns true when scoreRelease rejected the release (returned reason codes). */
export function isRejected(result: number | string[]): boolean {
  return Array.isArray(result);
}

/** Extracts the numeric score; throws if the release was rejected. */
export function numScore(result: number | string[]): number {
  if (Array.isArray(result)) throw new Error("Release was rejected");
  return result;
}

export const baseProfile: QualityProfileScoreInput = {
  minResolution: 1080,
  cutoffResolution: null,
  preferredSources: ["BluRay", "WEB-DL"],
  preferredCodecs: ["x265", "x264"],
  preferredLanguages: [],
  prioritizedTrackers: [],
  preferTrackerOverQuality: false,
  maxSizeGb: null,
  requireHdr: false,
  preferHdr: false,
  minSeeders: 0,
  customFormats: [],
};

export function parsed(overrides: Partial<ParsedRelease> = {}): ParsedRelease {
  return {
    resolution: 1080,
    source: "BluRay",
    codec: "x265",
    hdr: null,
    audio: null,
    group: null,
    streaming: null,
    isSample: false,
    isProper: false,
    ...overrides,
  };
}
