import { describe, expect, it } from "bun:test";
import type { LibraryAudioTrack } from "@rawkoon/shared";
import { audioFormatFromTracks, missingAudioFields } from "./audioFields";

const track = (over: Partial<LibraryAudioTrack>): LibraryAudioTrack => ({
  index: 0,
  language: "fr",
  language_name: "French",
  title: null,
  codec: "AC3",
  channels: 6,
  channel_layout: "5.1",
  bitrate_kbps: 448,
  default: false,
  forced: false,
  ...over,
});

describe("audioFormatFromTracks", () => {
  it("prefers the default track and normalizes legacy codec names", () => {
    expect(
      audioFormatFromTracks([
        track({ codec: "AAC" }),
        track({ index: 1, codec: "E-AC-3", default: true }),
      ]),
    ).toBe("EAC3");
  });
  it("falls back to the first track, and to null without a codec", () => {
    expect(audioFormatFromTracks([track({ codec: "DTS-HD MA" })])).toBe(
      "DTS-HD MA",
    );
    expect(audioFormatFromTracks([track({ codec: null })])).toBeNull();
    expect(audioFormatFromTracks([])).toBeNull();
  });
});

describe("missingAudioFields", () => {
  const base = {
    languageTags: [],
    audioFormat: null,
    fileName: "Movie (2020).mkv",
  };

  it("fills empty tags and format from stored tracks", () => {
    expect(
      missingAudioFields({
        ...base,
        audioTracks: [track({ language: "en", codec: "EAC3" })],
      }),
    ).toEqual({ languageTags: ["EN"], audioFormat: "EAC3" });
  });

  it("uses the file name to tell VFQ from a plain French track", () => {
    expect(
      missingAudioFields({
        ...base,
        fileName: "Movie.2020.VFQ.1080p.mkv",
        audioTracks: [track({})],
      }).languageTags,
    ).toEqual(["VFQ"]);
  });

  it("never overwrites values post-processing already set", () => {
    expect(
      missingAudioFields({
        audioTracks: [track({ codec: "AAC" })],
        languageTags: ["VFQ"],
        audioFormat: "TrueHD Atmos",
        fileName: "x.mkv",
      }),
    ).toEqual({});
  });

  it("does nothing without stored tracks", () => {
    expect(missingAudioFields({ ...base, audioTracks: [] })).toEqual({});
    expect(missingAudioFields({ ...base, audioTracks: null })).toEqual({});
  });
});
