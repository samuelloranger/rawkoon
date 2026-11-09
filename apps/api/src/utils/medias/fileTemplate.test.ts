import { describe, expect, it } from "bun:test";
import {
  renderBookTemplate,
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

describe("path templates stay byte-identical for real titles", () => {
  const ep = {
    season: 1,
    episode: 2,
    title: "Pilot",
    resolution: null,
    source: null,
    ext: "mkv",
  };
  // Titles with "/" still nest on purpose: changing it would split existing libraries.
  it("keeps the existing nesting for a slash in the show title", () => {
    expect(
      renderEpisodeTemplate("{show}/Season {season:2}/{show} - {title}.{ext}", {
        ...ep,
        show: "Fate/Zero",
      }),
    ).toBe("Fate/Zero/Season 01/Fate/Zero - Pilot.mkv");
  });
  it("keeps the space a question mark becomes", () => {
    expect(
      renderEpisodeTemplate("{show}.S{season:2}E{episode:2}.{ext}", {
        ...ep,
        show: "Who?",
      }),
    ).toBe("Who .S01E02.mkv");
  });
  it("renders a normal title unchanged", () => {
    expect(
      renderEpisodeTemplate("{show}/Season {season:2}/{show} - {title}.{ext}", {
        ...ep,
        show: "My Show",
      }),
    ).toBe("My Show/Season 01/My Show - Pilot.mkv");
  });
  it("drops dot segments", () => {
    expect(
      renderEpisodeTemplate("{show}/{title}.{ext}", { ...ep, show: ".." }),
    ).toBe("Pilot.mkv");
  });
  it("drops dot segments in book paths", () => {
    expect(
      renderBookTemplate("{author}/{title}", {
        author: "..",
        title: "X",
        year: null,
        format: null,
        language: null,
      }),
    ).toBe("X");
  });
});
