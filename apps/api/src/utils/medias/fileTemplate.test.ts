import { describe, expect, it } from "bun:test";
import {
  renderEpisodeTemplate,
  renderMovieTemplate,
  sanitizeFilenamePart,
} from "./fileTemplate";

describe("fileTemplate", () => {
  it("sanitizes unsafe filename characters", () => {
    // colon → " -" to match Sonarr/Radarr convention; other invalid chars → space
    expect(sanitizeFilenamePart('A<B>:C|D*"')).toBe("A B -C D");
  });

  it("converts colon to dash like Sonarr", () => {
    expect(sanitizeFilenamePart("Daredevil: Born Again")).toBe(
      "Daredevil - Born Again",
    );
  });

  it("renders movie template with year and quality", () => {
    const out = renderMovieTemplate(
      "{title} ({year}) [{resolution} {source}]",
      {
        title: "Test Movie",
        year: 2021,
        resolution: "1080p",
        source: "WEB-DL",
        codec: "x265",
        ext: ".mkv",
      },
    );
    expect(out).toContain("Test Movie");
    expect(out).toContain("2021");
    expect(out).toContain("1080p");
    expect(out).toContain("WEB-DL");
  });

  it("pads season and episode in episode template", () => {
    const out = renderEpisodeTemplate(
      "{show}/S{season:02}E{episode:02}-{title}",
      {
        show: "My Show",
        season: 3,
        episode: 7,
        title: "Pilot",
        resolution: null,
        source: null,
        ext: ".mkv",
      },
    );
    expect(out).toContain("My Show");
    expect(out).toContain("S03");
    expect(out).toContain("E07");
  });
});
