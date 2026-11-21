import { describe, expect, it } from "bun:test";
import { releaseYearFits } from "../releaseYear";

describe("releaseYearFits", () => {
  it("ignores years that are part of the title", () => {
    expect(
      releaseYearFits("Blade.Runner.2049.2017.1080p", 2017, [
        "Blade Runner 2049",
      ]),
    ).toBe(true);
    expect(releaseYearFits("2012.1080p.BluRay", 2009, ["2012"])).toBe(true);
  });
  it("allows one year either side and rejects the rest", () => {
    expect(releaseYearFits("Dune.2022.1080p", 2021, ["Dune"])).toBe(true);
    expect(releaseYearFits("Dune.1984.1080p", 2021, ["Dune"])).toBe(false);
  });
  it("does not read resolutions or bitrates as years", () => {
    expect(releaseYearFits("Movie.1920x1080.2000kbps", 1999, ["Movie"])).toBe(
      true,
    );
  });
});
