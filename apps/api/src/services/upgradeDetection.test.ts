import { describe, it, expect } from "bun:test";
import { filesFailProfile } from "./upgradeDetection";
import type { QualityProfileScoreInput } from "@rawkoon/api/utils/medias/releaseScorer";

const profile: QualityProfileScoreInput = {
  minResolution: 1080,
  cutoffResolution: null,
  preferredSources: [],
  preferredCodecs: [],
  preferredLanguages: [],
  prioritizedTrackers: [],
  preferTrackerOverQuality: false,
  maxSizeGb: null,
  requireHdr: false,
  preferHdr: false,
  minSeeders: 0,
  customFormats: [],
};

describe("filesFailProfile", () => {
  it("returns true when resolution is below minResolution", () => {
    const files = [
      {
        resolution: 720,
        source: "WEB-DL",
        videoCodec: "x264",
        hdrFormat: null,
        sizeBytes: null as bigint | null,
        languageTags: [] as string[],
      },
    ];
    expect(filesFailProfile(files, profile)).toBe(true);
  });

  it("returns false when resolution meets minResolution", () => {
    const files = [
      {
        resolution: 1080,
        source: "BluRay",
        videoCodec: "x265",
        hdrFormat: null,
        sizeBytes: null as bigint | null,
        languageTags: [] as string[],
      },
    ];
    expect(filesFailProfile(files, profile)).toBe(false);
  });

  it("returns true when resolution is null (unknown quality)", () => {
    const files = [
      {
        resolution: null,
        source: null,
        videoCodec: null,
        hdrFormat: null,
        sizeBytes: null as bigint | null,
        languageTags: [] as string[],
      },
    ];
    expect(filesFailProfile(files, profile)).toBe(true);
  });

  it("returns false for empty files (nothing to upgrade)", () => {
    expect(filesFailProfile([], profile)).toBe(false);
  });

  it("requires HDR when profile.requireHdr is true", () => {
    const hdrProfile: QualityProfileScoreInput = {
      ...profile,
      requireHdr: true,
    };
    const files = [
      {
        resolution: 1080,
        source: "BluRay",
        videoCodec: "x265",
        hdrFormat: null,
        sizeBytes: null as bigint | null,
        languageTags: [] as string[],
      },
    ];
    expect(filesFailProfile(files, hdrProfile)).toBe(true);
  });

  const validFile = {
    resolution: 1080,
    source: "BluRay",
    videoCodec: "x265",
    hdrFormat: null,
    sizeBytes: null as bigint | null,
    languageTags: [] as string[],
    releaseGroup: "GROUP" as string | null,
  };

  it("does NOT fail a valid file for a required release-only format (seeders)", () => {
    // A required custom format on `seeders` can't be observed from a file —
    // it must not flag an already-valid download as needing an upgrade.
    const p: QualityProfileScoreInput = {
      ...profile,
      customFormats: [
        {
          name: "Healthy",
          conditions: [{ type: "seeders", operator: "gte", value: 5 }],
          score: 0,
          required: true,
          forbidden: false,
        },
      ],
    };
    expect(filesFailProfile([validFile], p)).toBe(false);
  });

  it("does NOT fail a valid file for a required title_regex format", () => {
    const p: QualityProfileScoreInput = {
      ...profile,
      customFormats: [
        {
          name: "TitleRule",
          conditions: [
            { type: "title_regex", operator: "matches", value: "atmos" },
          ],
          score: 0,
          required: true,
          forbidden: false,
        },
      ],
    };
    expect(filesFailProfile([validFile], p)).toBe(false);
  });

  it("does NOT fail a valid file when profile.minSeeders > 0", () => {
    expect(filesFailProfile([validFile], { ...profile, minSeeders: 5 })).toBe(
      false,
    );
  });

  it("DOES fail when a file-observable required format is unmet (release_group)", () => {
    const p: QualityProfileScoreInput = {
      ...profile,
      customFormats: [
        {
          name: "PreferredGroup",
          conditions: [
            { type: "release_group", operator: "matches", value: "^OTHER$" },
          ],
          score: 0,
          required: true,
          forbidden: false,
        },
      ],
    };
    expect(filesFailProfile([validFile], p)).toBe(true);
  });

  it("does NOT fail when a file-observable required format IS met (release_group)", () => {
    const p: QualityProfileScoreInput = {
      ...profile,
      customFormats: [
        {
          name: "PreferredGroup",
          conditions: [
            { type: "release_group", operator: "matches", value: "^GROUP$" },
          ],
          score: 0,
          required: true,
          forbidden: false,
        },
      ],
    };
    expect(filesFailProfile([validFile], p)).toBe(false);
  });
});
