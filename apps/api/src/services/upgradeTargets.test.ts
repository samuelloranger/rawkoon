import { describe, it, expect, mock } from "bun:test";
import type { QualityProfileScoreInput } from "@rawkoon/api/utils/medias/releaseScorer";

const file = (episodeId: number, resolution: number) => ({
  episodeId,
  resolution,
  source: "WEB-DL",
  videoCodec: "x264",
  hdrFormat: null,
  sizeBytes: null,
  languageTags: [],
  releaseGroup: null,
});

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryEpisode: {
      findMany: async () => [{ id: 1 }, { id: 2 }, { id: 3 }],
    },
    mediaFile: {
      findMany: async () => [file(1, 720), file(2, 1080), file(3, 2160)],
    },
  },
}));

const { downloadedEpisodesFailingProfile } = await import(
  "@rawkoon/api/services/upgradeTargets"
);

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

describe("downloadedEpisodesFailingProfile", () => {
  it("returns only the episodes whose files fail the profile", async () => {
    expect(await downloadedEpisodesFailingProfile(9, profile)).toEqual([1]);
  });
});
