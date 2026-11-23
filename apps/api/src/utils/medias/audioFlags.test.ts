import { describe, expect, it } from "bun:test";
import { parseAudioFlags } from "@rawkoon/api/utils/medias/filenameParser";

describe("parseAudioFlags French variants", () => {
  it("TRUEFRENCH also emits VFF", () => {
    expect(
      parseAudioFlags("Some.Film.2020.TRUEFRENCH.1080p.BluRay-GRP"),
    ).toEqual(["TRUEFRENCH", "VFF"]);
    expect(
      parseAudioFlags("Some.Film.2020.MULTi.TRUEFRENCH.1080p.BluRay-GRP"),
    ).toEqual(["MULTI", "TRUEFRENCH", "VFF"]);
  });

  it("a bare MULTi also emits generic fr", () => {
    expect(parseAudioFlags("Some.Film.2020.MULTi.1080p.WEB-GRP")).toEqual([
      "MULTI",
      "fr",
    ]);
  });

  it("MULTi.VOSTFR is not French audio", () => {
    expect(
      parseAudioFlags("Some.Film.2020.MULTi.VOSTFR.1080p.WEB-GRP"),
    ).toEqual(["MULTI", "VOSTFR"]);
  });

  it("MULTi with a French variant keeps its flags unchanged", () => {
    expect(parseAudioFlags("Some.Film.2020.MULTi.VFF.1080p.WEB-GRP")).toEqual([
      "MULTI",
      "VFF",
    ]);
    expect(parseAudioFlags("Some.Film.2020.MULTi.VFQ.1080p.WEB-GRP")).toEqual([
      "MULTI",
      "VFQ",
    ]);
    expect(parseAudioFlags("Some.Film.2020.MULTi.VF2.1080p.WEB-GRP")).toEqual([
      "MULTI",
      "VF2",
    ]);
  });

  it("MULTi.FRENCH is French, not a bare MULTi", () => {
    expect(
      parseAudioFlags("Some.Film.2020.MULTi.FRENCH.1080p.WEB-GRP"),
    ).toEqual(["MULTI", "FRENCH", "fr"]);
  });

  it("a release with no French or multi tag has no French flag", () => {
    expect(parseAudioFlags("Some.Film.2020.1080p.WEB-GRP")).toEqual([]);
  });
});

describe("parseAudioFlags original French", () => {
  it("VOF is original France-French audio", () => {
    expect(parseAudioFlags("Some.Show.S07.VOF.1080p.WEB.H265-GRP")).toEqual([
      "VOF",
      "VFF",
    ]);
  });

  it("VOQ is original Québec-French audio and hides a trailing FRENCH", () => {
    expect(
      parseAudioFlags("Some.Film.2024.VOQ.1080p.BluRay.x265.FRENCH-GRP"),
    ).toEqual(["VOQ", "VFQ"]);
  });

  it("does not read VOQ inside a word", () => {
    expect(parseAudioFlags("La.Provoquee.2020.1080p.WEB-GRP")).toEqual([]);
  });
});
