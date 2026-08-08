import { describe, expect, it } from "bun:test";
import { tracksCompatible, type TrackShape } from "./mkvMerge";

function file(
  audioLanguages: string[],
  subtitleLanguages: string[],
  videoCodec = "AV1",
): TrackShape {
  return {
    videoCodec,
    audioTracks: audioLanguages.map((language, index) => ({
      index,
      language,
      language_name: language,
      title: null,
      codec: "EAC3",
      channels: 6,
      channel_layout: "5.1",
      bitrate_kbps: 640,
      default: index === 0,
      forced: false,
    })),
    subtitleTracks: subtitleLanguages.map((language, index) => ({
      index,
      language,
      language_name: language,
      title: null,
      format: "SRT",
      forced: false,
      hearing_impaired: false,
    })),
  };
}

describe("tracksCompatible", () => {
  it("accepts identical layouts", () => {
    expect(
      tracksCompatible(
        file(["fre", "eng"], ["fre", "fre", "eng"]),
        file(["fre", "eng"], ["fre", "fre", "eng"]),
      ),
    ).toBe(true);
  });

  it("rejects a differing video codec", () => {
    expect(
      tracksCompatible(
        file(["fre", "eng"], [], "AV1"),
        file(["fre", "eng"], [], "H264"),
      ),
    ).toBe(false);
  });

  it("rejects a differing audio track count", () => {
    expect(tracksCompatible(file(["fre", "eng"], []), file(["fre"], []))).toBe(
      false,
    );
  });

  it("rejects a differing subtitle track count", () => {
    expect(
      tracksCompatible(file(["fre"], ["fre", "eng"]), file(["fre"], ["fre"])),
    ).toBe(false);
  });

  it("rejects differing audio languages", () => {
    expect(
      tracksCompatible(file(["fre", "eng"], []), file(["eng", "spa"], [])),
    ).toBe(false);
  });

  it("rejects a differing audio track order", () => {
    // mkvmerge appends by track order, so swapped languages would leave the
    // second half of the episode playing the wrong audio.
    expect(
      tracksCompatible(file(["fre", "eng"], []), file(["eng", "fre"], [])),
    ).toBe(false);
  });
});
