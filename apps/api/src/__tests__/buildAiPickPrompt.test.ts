import { describe, it, expect } from "bun:test";
import { buildAiPickPrompt } from "@rawkoon/api/utils/medias/buildAiPickPrompt";
import type { QualityProfileScoreInput } from "@rawkoon/api/utils/medias/releaseScorer";

const releases = [
  {
    key: "guid-1",
    title: "Movie.2024.1080p.BluRay.x265-GROUP",
    size_bytes: 8_000_000_000,
    seeders: 42,
    score: 2500,
  },
  {
    key: "guid-2",
    title: "Movie.2024.720p.WEB-DL.x264-OTHER",
    size_bytes: 3_000_000_000,
    seeders: 12,
    score: 1200,
  },
];

describe("buildAiPickPrompt", () => {
  it("includes media title and year", () => {
    const prompt = buildAiPickPrompt(
      { title: "My Movie", year: 2024, type: "movie" },
      releases,
    );
    expect(prompt).toContain("My Movie");
    expect(prompt).toContain("2024");
  });

  it("includes each release key", () => {
    const prompt = buildAiPickPrompt(
      { title: "My Movie", year: null, type: "movie" },
      releases,
    );
    expect(prompt).toContain("guid-1");
    expect(prompt).toContain("guid-2");
  });

  it("includes size in GB", () => {
    const prompt = buildAiPickPrompt(
      { title: "My Movie", year: null, type: "movie" },
      releases,
    );
    expect(prompt).toContain("8.0 GB");
    expect(prompt).toContain("3.0 GB");
  });

  it("handles null size_bytes gracefully", () => {
    const prompt = buildAiPickPrompt(
      { title: "My Movie", year: null, type: "movie" },
      [{ key: "g", title: "T", size_bytes: null, seeders: null, score: null }],
    );
    expect(prompt).toContain("unknown size");
  });
});

const profile: QualityProfileScoreInput = {
  minResolution: 1080,
  cutoffResolution: 2160,
  preferredSources: ["bluray", "web"],
  preferredCodecs: ["x265"],
  preferredLanguages: ["VFQ", "VFF"],
  prioritizedTrackers: ["TrackerA"],
  preferTrackerOverQuality: false,
  maxSizeGb: 20,
  requireHdr: false,
  preferHdr: true,
  minSeeders: 0,
  customFormats: [
    {
      name: "Team",
      conditions: [
        { type: "release_group", operator: "matches", value: "GROUP" },
      ],
      score: 100,
      required: false,
      forbidden: false,
    },
    {
      name: "Atmos",
      conditions: [
        { type: "title_regex", operator: "matches", value: "Atmos" },
      ],
      score: -50,
      required: false,
      forbidden: false,
    },
  ],
};

describe("buildAiPickPrompt target and profile header", () => {
  it("prints the target episode and the profile's preferences", () => {
    const prompt = buildAiPickPrompt(
      { title: "Show", year: null, type: "tv", season: 2, episode: 5, profile },
      releases,
    );
    expect(prompt).toContain("Target: S02E05");
    expect(prompt).toContain("Preferred audio languages: VFQ, VFF");
    expect(prompt).toContain("Resolution: 1080p-2160p");
    expect(prompt).toContain("Sources: bluray > web");
    expect(prompt).toContain("Codecs: x265");
    expect(prompt).toContain("HDR: preferred");
    expect(prompt).toContain("Size cap: 20 GB");
    expect(prompt).toContain("Trackers: TrackerA");
    expect(prompt).not.toContain("outrank quality");
    expect(prompt).toContain("Liked formats: Team");
    expect(prompt).toContain("Disliked formats: Atmos");
  });

  it("flags trackers that outrank quality", () => {
    const prompt = buildAiPickPrompt(
      {
        title: "Show",
        year: null,
        type: "tv",
        profile: { ...profile, preferTrackerOverQuality: true },
      },
      releases,
    );
    expect(prompt).toContain("Trackers: TrackerA (outrank quality)");
  });

  it("says a single resolution when the minimum is the cutoff", () => {
    const prompt = buildAiPickPrompt(
      {
        title: "Show",
        year: null,
        type: "tv",
        profile: { ...profile, cutoffResolution: 1080 },
      },
      releases,
    );
    expect(prompt).toContain("Resolution: 1080p only");
  });

  it("omits the target and profile lines when absent", () => {
    const prompt = buildAiPickPrompt(
      { title: "Show", year: null, type: "tv" },
      releases,
    );
    expect(prompt).not.toContain("Target:");
    expect(prompt).not.toContain("Preferred audio languages");
    expect(prompt).not.toContain("Resolution:");
  });
});

describe("buildAiPickPrompt release traits", () => {
  it("never shows the classic score", () => {
    const prompt = buildAiPickPrompt(
      { title: "Movie", year: 2024, type: "movie", profile },
      releases,
    );
    expect(prompt).not.toContain("score");
    expect(prompt).not.toContain("2500");
  });

  it("lists parsed resolution, source, codec and audio per release", () => {
    const prompt = buildAiPickPrompt(
      { title: "Movie", year: 2024, type: "movie" },
      [
        {
          key: "a",
          title: "Movie.2024.MULTi.VFQ.2160p.WEB.HDR.x265-GROUP",
          size_bytes: null,
          seeders: 3,
          score: null,
        },
        {
          key: "b",
          title: "Movie.2024.720p.HDTV.x264-OTHER",
          size_bytes: null,
          seeders: 3,
          score: null,
        },
      ],
    );
    const [lineA, lineB] = prompt.split("\n").filter((l) => l.includes("key="));
    expect(lineA).toContain("res:2160p");
    expect(lineA).toMatch(/codec:(x265|hevc)/i);
    expect(lineA).toContain("hdr:");
    expect(lineA).toContain("audio:MULTI+VFQ");
    expect(lineB).toContain("res:720p");
    expect(lineB).toContain("audio:untagged");
    expect(lineB).not.toContain("hdr:");
  });

  it("names the tracker, freeleech and matched custom formats", () => {
    const prompt = buildAiPickPrompt(
      { title: "Movie", year: 2024, type: "movie", profile },
      [
        {
          key: "a",
          title: "Movie.2024.1080p.BluRay.Atmos.x265-GROUP",
          size_bytes: null,
          seeders: 3,
          score: null,
          indexer: "TrackerA",
          freeleech: true,
        },
      ],
    );
    expect(prompt).toContain("tracker:TrackerA");
    expect(prompt).toContain("freeleech");
    expect(prompt).toContain("formats:Team,Atmos");
  });

  it("lists no formats without a profile", () => {
    const prompt = buildAiPickPrompt(
      { title: "Movie", year: 2024, type: "movie" },
      releases,
    );
    expect(prompt).not.toContain("formats:");
  });
});
