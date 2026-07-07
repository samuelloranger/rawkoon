import { describe, it, expect } from "bun:test";
import { classifyLanguageTags } from "../languageTags";
import type { LibraryAudioTrack } from "../../types/library";

function track(
  language: string,
  title: string | null = null,
): LibraryAudioTrack {
  return {
    index: 0,
    language,
    language_name: language,
    title,
    codec: null,
    channels: null,
    channel_layout: null,
    bitrate_kbps: null,
    default: false,
    forced: false,
  };
}

describe("classifyLanguageTags", () => {
  it("returns empty array when no tracks", () => {
    expect(classifyLanguageTags([])).toEqual([]);
    expect(classifyLanguageTags(null)).toEqual([]);
    expect(classifyLanguageTags(undefined)).toEqual([]);
  });

  it("tags English-only as EN", () => {
    expect(classifyLanguageTags([track("eng")])).toEqual(["EN"]);
    expect(classifyLanguageTags([track("en")])).toEqual(["EN"]);
    expect(classifyLanguageTags([track("en-")])).toEqual(["EN"]);
  });

  it("tags French with VFQ keyword in track title", () => {
    expect(classifyLanguageTags([track("fra", "French (VFQ)")])).toEqual([
      "VFQ",
    ]);
    expect(classifyLanguageTags([track("fre", "Québécois")])).toEqual(["VFQ"]);
    expect(classifyLanguageTags([track("fra", "VQC")])).toEqual(["VFQ"]);
    expect(classifyLanguageTags([track("fra", "Version canadienne")])).toEqual([
      "VFQ",
    ]);
    expect(classifyLanguageTags([track("fr", "French Canada")])).toEqual([
      "VFQ",
    ]);
  });

  it("tags French with VFF keyword in track title", () => {
    expect(classifyLanguageTags([track("fra", "VFF")])).toEqual(["VFF"]);
    expect(classifyLanguageTags([track("fra", "European French")])).toEqual([
      "VFF",
    ]);
    expect(classifyLanguageTags([track("fre", "Parisian French")])).toEqual([
      "VFF",
    ]);
  });

  it("tags French with VFI keyword in track or release name", () => {
    expect(classifyLanguageTags([track("fra", "VFI")])).toEqual(["VFI"]);
    expect(classifyLanguageTags([track("fra", "International")])).toEqual([
      "VFI",
    ]);
    expect(
      classifyLanguageTags([track("fra", null)], "Movie.2024.VFI.1080p"),
    ).toEqual(["VFI"]);
  });

  it("falls back to release name when track title silent", () => {
    expect(
      classifyLanguageTags([track("fra", null)], "Movie.2024.VFQ.1080p"),
    ).toEqual(["VFQ"]);
    expect(
      classifyLanguageTags([track("fra", null)], "Movie.2024.VFF.1080p"),
    ).toEqual(["VFF"]);
  });

  it("tags generic French when no regional signal", () => {
    expect(classifyLanguageTags([track("fra", null)])).toEqual(["FR"]);
    expect(classifyLanguageTags([track("fra", "Main audio")])).toEqual(["FR"]);
  });

  it("maps regional French codes to the right variant", () => {
    expect(classifyLanguageTags([track("fr-CA", null)])).toEqual(["VFQ"]);
    expect(classifyLanguageTags([track("fr-FR", null)])).toEqual(["VFF"]);
    expect(classifyLanguageTags([track("fr-", null)])).toEqual(["FR"]);
  });

  it("combines multiple distinct tags", () => {
    expect(classifyLanguageTags([track("eng"), track("fra", "VFQ")])).toEqual([
      "EN",
      "VFQ",
    ]);
  });

  it("deduplicates equal tags", () => {
    expect(
      classifyLanguageTags([track("eng", "Commentary"), track("eng")]),
    ).toEqual(["EN"]);
  });

  it("uppercases ISO code for other languages", () => {
    expect(classifyLanguageTags([track("spa")])).toEqual(["SPA"]);
    expect(classifyLanguageTags([track("jpn")])).toEqual(["JPN"]);
    expect(classifyLanguageTags([track("deu")])).toEqual(["DEU"]);
  });

  it("marks undetermined tracks as UND", () => {
    expect(classifyLanguageTags([track("und")])).toEqual(["UND"]);
    expect(classifyLanguageTags([track("")])).toEqual(["UND"]);
  });

  it("orders tags EN, VFQ, VFF, VFI, FR, then alpha", () => {
    const tags = classifyLanguageTags([
      track("spa"),
      track("fra", "VFI"),
      track("fra", "VFF"),
      track("fra", "VFQ"),
      track("eng"),
      track("deu"),
    ]);
    expect(tags).toEqual(["EN", "VFQ", "VFF", "VFI", "DEU", "SPA"]);
  });

  it("normalizes accented characters when matching", () => {
    expect(classifyLanguageTags([track("fra", "quebecois")])).toEqual(["VFQ"]);
    expect(classifyLanguageTags([track("fra", "QUÉBEC")])).toEqual(["VFQ"]);
  });
});
