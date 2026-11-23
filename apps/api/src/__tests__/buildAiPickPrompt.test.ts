import { describe, it, expect } from "bun:test";
import {
  buildAiPickPrompt,
  releaseFitsTarget,
} from "@rawkoon/api/utils/medias/buildAiPickPrompt";
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

  it("caps format names to the strongest few", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      name: `F${i}`,
      conditions: [
        {
          type: "title_regex" as const,
          operator: "matches" as const,
          value: "Movie",
        },
      ],
      score: (i + 1) * 10,
      required: false,
      forbidden: false,
    }));
    const prompt = buildAiPickPrompt(
      {
        title: "Movie",
        year: 2024,
        type: "movie",
        profile: { ...profile, customFormats: many },
      },
      releases,
    );
    expect(prompt).toContain("Liked formats: F7, F6, F5, F4, F3\n");
    expect(prompt).toMatch(/formats:F0,F1,F2,F3,F4$/m);
  });

  it("ranks audio, source and codec against the profile", () => {
    const prompt = buildAiPickPrompt(
      { title: "Movie", year: 2024, type: "movie", profile },
      [
        {
          key: "a",
          title: "Movie.2024.MULTi.VFF.1080p.WEBRip.x264-GROUP",
          size_bytes: null,
          seeders: 3,
          score: null,
        },
        {
          key: "b",
          title: "Movie.2024.MULTi.VFQ.1080p.BluRay.x265-GROUP",
          size_bytes: null,
          seeders: 3,
          score: null,
        },
      ],
    );
    const [lineA, lineB] = prompt.split("\n").filter((l) => l.includes("key="));
    expect(lineA).toContain("src:WEBRip(#2)");
    expect(lineA).toContain("codec:x264(-)");
    expect(lineA).toContain("audio:MULTI+VFF(#2)");
    expect(lineB).toContain("src:BluRay(#1)");
    expect(lineB).toContain("codec:x265(#1)");
    expect(lineB).toContain("audio:MULTI+VFQ(#1)");
  });

  it("keeps only releases that fill the target", () => {
    const episode = { season: 1, episode: 5 };
    expect(releaseFitsTarget("Show.S01E05.1080p.WEB", episode)).toBe(true);
    expect(releaseFitsTarget("Show.S01E01.1080p.WEB", episode)).toBe(false);
    expect(releaseFitsTarget("Show.S02E05.1080p.WEB", episode)).toBe(false);
    expect(releaseFitsTarget("Show.S01.1080p.WEB", episode)).toBe(true);

    const pack = { season: 3, episode: null };
    expect(releaseFitsTarget("Show.S03.1080p.WEB", pack)).toBe(true);
    // A single episode is not the season pack that was asked for.
    expect(releaseFitsTarget("Show.S03E06.1080p.WEB", pack)).toBe(false);
    expect(releaseFitsTarget("Show.S06.1080p.WEB", { season: 7 })).toBe(false);

    expect(releaseFitsTarget("Movie.2020.1080p.WEB", {})).toBe(true);
  });

  it("marks how each release's size sits for its resolution", () => {
    const prompt = buildAiPickPrompt(
      { title: "Movie", year: 2024, type: "movie" },
      [
        ["Movie.2024.1080p.BluRay.x265", 4e9],
        ["Movie.2024.1080p.BluRay.x264", 12e9],
        ["Movie.2024.1080p.BluRay.REMUX.AVC", 30e9],
        ["Movie.2024.1080p.WEB.x265", 0.6e9],
      ].map(([title, size], i) => ({
        key: `k${i}`,
        title: title as string,
        size_bytes: size as number,
        seeders: 1,
        score: null,
      })),
    );
    const sizes = prompt
      .split("\n")
      .filter((l) => l.includes("key="))
      .map((l) => l.match(/size:(\w+)/)?.[1]);
    expect(sizes).toEqual(["ok", "large", "bloated", "small"]);
  });

  it("lists no formats without a profile", () => {
    const prompt = buildAiPickPrompt(
      { title: "Movie", year: 2024, type: "movie" },
      releases,
    );
    expect(prompt).not.toContain("formats:");
  });
});
