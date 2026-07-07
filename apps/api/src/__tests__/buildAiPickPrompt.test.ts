import { describe, it, expect } from "bun:test";
import { buildAiPickPrompt } from "@rawkoon/api/utils/medias/buildAiPickPrompt";

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
