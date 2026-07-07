import { describe, it, expect } from "bun:test";
// Import from mediainfoParser directly — other test files only mock mediainfoScanner,
// so this import always resolves to the real implementation regardless of parallelism.
import { parseMediaInfoJson } from "./mediainfoParser";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DOLBY_VISION_REMUX = {
  media: {
    track: [
      {
        "@type": "General",
        FileSize: "52428800000",
        Duration: "7422.5",
        Encoded_Library_Name: "GROUP",
      },
      {
        "@type": "Video",
        Format: "HEVC",
        Format_Profile: "Main 10",
        Width: "3840",
        Height: "2160",
        FrameRate: "23.976",
        BitDepth: "10",
        BitRate: "60000000",
        HDR_Format: "SMPTE ST 2084",
        HDR_Format_Commercial: "Dolby Vision, HDR10",
      },
      {
        "@type": "Audio",
        Language: "eng",
        Title: "TrueHD Atmos",
        Format: "MLP FBA 16-ch",
        Channels: "8",
        ChannelLayout: "L R C LFE Ls Rs Lss Rss",
        BitRate: "4800000",
        Default: "Yes",
        Forced: "No",
      },
      {
        "@type": "Audio",
        Language: "fra",
        Title: "French (CA)",
        Format: "AC-3",
        Channels: "6",
        ChannelLayout: "L R C LFE Ls Rs",
        BitRate: "640000",
        Default: "No",
        Forced: "No",
      },
      {
        "@type": "Text",
        Language: "eng",
        Title: "English (SDH)",
        Format: "PGS",
        Forced: "No",
        HearingImpaired: "Yes",
      },
    ],
  },
};

const WEB_DL_HDR10 = {
  media: {
    track: [
      {
        "@type": "General",
        FileSize: "8589934592",
        Duration: "6840.0",
      },
      {
        "@type": "Video",
        Format: "HEVC",
        Format_Profile: "Main 10",
        Width: "3840",
        Height: "2160",
        FrameRate: "23.976",
        BitDepth: "10",
        BitRate: "15000000",
        HDR_Format: "SMPTE ST 2084",
        HDR_Format_Commercial: "HDR10",
      },
      {
        "@type": "Audio",
        Language: "eng",
        Format: "EAC-3",
        Channels: "6",
        ChannelLayout: "L R C LFE Ls Rs",
        BitRate: "768000",
        Default: "Yes",
        Forced: "No",
      },
    ],
  },
};

const STANDARD_1080P_X264 = {
  media: {
    track: [
      {
        "@type": "General",
        FileSize: "2147483648",
        Duration: "5400.0",
        Encoded_Library_Name: "YIFY",
      },
      {
        "@type": "Video",
        Format: "AVC",
        Format_Profile: "High",
        Width: "1920",
        Height: "1080",
        FrameRate: "23.976",
        BitDepth: "8",
        BitRate: "2000000",
      },
      {
        "@type": "Audio",
        Language: "eng",
        Format: "AAC LC",
        Channels: "2",
        ChannelLayout: "L R",
        BitRate: "192000",
        Default: "Yes",
        Forced: "No",
      },
    ],
  },
};

const MULTI_AUDIO_FR_EN = {
  media: {
    track: [
      {
        "@type": "General",
        FileSize: "4294967296",
        Duration: "9000.0",
      },
      {
        "@type": "Video",
        Format: "HEVC",
        Format_Profile: "Main",
        Width: "1920",
        Height: "1080",
        FrameRate: "23.976",
        BitDepth: "8",
        BitRate: "8000000",
      },
      {
        "@type": "Audio",
        Language: "fra",
        Title: "French (CA)",
        Format: "AC-3",
        Channels: "6",
        ChannelLayout: "L R C LFE Ls Rs",
        BitRate: "640000",
        Default: "Yes",
        Forced: "No",
      },
      {
        "@type": "Audio",
        Language: "fra",
        Title: "French (FR)",
        Format: "AC-3",
        Channels: "6",
        ChannelLayout: "L R C LFE Ls Rs",
        BitRate: "640000",
        Default: "No",
        Forced: "No",
      },
      {
        "@type": "Audio",
        Language: "eng",
        Title: "English",
        Format: "AC-3",
        Channels: "6",
        ChannelLayout: "L R C LFE Ls Rs",
        BitRate: "640000",
        Default: "No",
        Forced: "No",
      },
    ],
  },
};

const SUBTITLES_HEAVY = {
  media: {
    track: [
      {
        "@type": "General",
        FileSize: "1073741824",
        Duration: "5400.0",
      },
      {
        "@type": "Video",
        Format: "AVC",
        Format_Profile: "High",
        Width: "1280",
        Height: "720",
        FrameRate: "23.976",
        BitDepth: "8",
        BitRate: "3000000",
      },
      {
        "@type": "Audio",
        Language: "jpn",
        Format: "AAC LC",
        Channels: "2",
        ChannelLayout: "L R",
        BitRate: "192000",
        Default: "Yes",
        Forced: "No",
      },
      {
        "@type": "Text",
        Language: "eng",
        Title: "English",
        Format: "ASS",
        Forced: "No",
        HearingImpaired: "No",
      },
      {
        "@type": "Text",
        Language: "fra",
        Title: "Forced",
        Format: "ASS",
        Forced: "Yes",
        HearingImpaired: "No",
      },
      {
        "@type": "Text",
        Language: "eng",
        Title: "English (SDH)",
        Format: "ASS",
        Forced: "No",
        HearingImpaired: "Yes",
      },
    ],
  },
};

const MALFORMED_LANGUAGE_CODES = {
  media: {
    track: [
      {
        "@type": "General",
        FileSize: "2147483648",
        Duration: "5400.0",
      },
      {
        "@type": "Video",
        Format: "AVC",
        Format_Profile: "High",
        Width: "1920",
        Height: "1080",
        FrameRate: "23.976",
        BitDepth: "8",
        BitRate: "2000000",
      },
      {
        "@type": "Audio",
        Language: "en-",
        Title: "English",
        Format: "AAC LC",
        Channels: "2",
        ChannelLayout: "L R",
        BitRate: "192000",
        Default: "Yes",
        Forced: "No",
      },
      {
        "@type": "Audio",
        Language: "fr-CA",
        Title: "French",
        Format: "AC-3",
        Channels: "6",
        ChannelLayout: "L R C LFE Ls Rs",
        BitRate: "640000",
        Default: "No",
        Forced: "No",
      },
      {
        "@type": "Text",
        Language: "en-US",
        Title: "English",
        Format: "SRT",
        Forced: "No",
        HearingImpaired: "No",
      },
    ],
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("scanMediaInfo", () => {
  it("fixture 1: Dolby Vision REMUX — parses HDR, audio, subtitles", () => {
    const result = parseMediaInfoJson(
      JSON.stringify(DOLBY_VISION_REMUX),
      "/media/Movie.2023.2160p.BluRay.REMUX.HEVC.TrueHD.Atmos-GROUP.mkv",
    );

    expect(result).not.toBeNull();
    expect(result!.videoCodec).toBe("HEVC");
    expect(result!.bitDepth).toBe(10);
    expect(result!.hdrFormat).toBe("Dolby Vision");
    expect(result!.resolution).toBe(2160);
    expect(result!.source).toBe("REMUX");
    expect(result!.releaseGroup).toBe("GROUP");
    expect(result!.sizeBytes).toBe(52428800000n);

    expect(result!.audioTracks).toHaveLength(2);
    expect(result!.audioTracks[0].language).toBe("eng");
    expect(result!.audioTracks[0].channel_layout).toBe("7.1");
    expect(result!.audioTracks[0].default).toBe(true);
    expect(result!.audioTracks[1].language).toBe("fra");
    expect(result!.audioTracks[1].title).toBe("French (CA)");
    expect(result!.audioTracks[1].channel_layout).toBe("5.1");

    expect(result!.subtitleTracks).toHaveLength(1);
    expect(result!.subtitleTracks[0].hearing_impaired).toBe(true);
    expect(result!.subtitleTracks[0].format).toBe("PGS");
  });

  it("fixture 2: WEB-DL HDR10 — parses correct HDR label", () => {
    const result = parseMediaInfoJson(
      JSON.stringify(WEB_DL_HDR10),
      "/media/Movie.2023.2160p.WEB-DL.DDP5.1.HEVC-GROUP.mkv",
    );

    expect(result).not.toBeNull();
    expect(result!.hdrFormat).toBe("HDR10");
    expect(result!.source).toBe("WEB-DL");
    expect(result!.resolution).toBe(2160);
    expect(result!.audioTracks[0].channel_layout).toBe("5.1");
  });

  it("fixture 3: Standard 1080p x264 — no HDR, stereo, release group from library name", () => {
    const result = parseMediaInfoJson(
      JSON.stringify(STANDARD_1080P_X264),
      "/media/Movie.2023.1080p.BluRay.x264-YIFY.mp4",
    );

    expect(result).not.toBeNull();
    expect(result!.hdrFormat).toBeNull();
    expect(result!.videoCodec).toBe("AVC");
    expect(result!.bitDepth).toBe(8);
    expect(result!.resolution).toBe(1080);
    expect(result!.releaseGroup).toBe("YIFY");
    expect(result!.audioTracks[0].channel_layout).toBe("stereo");
    expect(result!.source).toBe("BluRay");
  });

  it("fixture 4: Multi-audio French (CA) + French (FR) + English — all tracks parsed", () => {
    const result = parseMediaInfoJson(
      JSON.stringify(MULTI_AUDIO_FR_EN),
      "/media/Movie.2023.1080p.BluRay.x265-GROUP.mkv",
    );

    expect(result).not.toBeNull();
    expect(result!.audioTracks).toHaveLength(3);

    const frCa = result!.audioTracks[0];
    expect(frCa.language).toBe("fra");
    expect(frCa.language_name).toBe("French");
    expect(frCa.title).toBe("French (CA)");
    expect(frCa.default).toBe(true);

    const frFr = result!.audioTracks[1];
    expect(frFr.language).toBe("fra");
    expect(frFr.title).toBe("French (FR)");
    expect(frFr.default).toBe(false);

    const en = result!.audioTracks[2];
    expect(en.language).toBe("eng");
    expect(en.language_name).toBe("English");
  });

  it("fixture 5: Heavy subtitles — parses forced, SDH, and regular subtitle tracks", () => {
    const result = parseMediaInfoJson(
      JSON.stringify(SUBTITLES_HEAVY),
      "/media/Anime.2023.720p.BluRay.AAC-GROUP.mkv",
    );

    expect(result).not.toBeNull();
    expect(result!.resolution).toBe(720);

    expect(result!.audioTracks).toHaveLength(1);
    expect(result!.audioTracks[0].language).toBe("jpn");
    expect(result!.audioTracks[0].language_name).toBe("Japanese");

    expect(result!.subtitleTracks).toHaveLength(3);

    const forced = result!.subtitleTracks.find((s) => s.forced);
    expect(forced).toBeDefined();
    expect(forced!.language).toBe("fra");

    const sdh = result!.subtitleTracks.find((s) => s.hearing_impaired);
    expect(sdh).toBeDefined();
    expect(sdh!.language).toBe("eng");

    expect(result!.subtitleTracks[0].format).toBe("ASS");
  });

  it("normalizes malformed language codes before storing tracks", () => {
    const result = parseMediaInfoJson(
      JSON.stringify(MALFORMED_LANGUAGE_CODES),
      "/media/Send.Help.2026.1080p-GROUP.mkv",
    );

    expect(result).not.toBeNull();
    expect(result!.audioTracks[0].language).toBe("en");
    expect(result!.audioTracks[0].language_name).toBe("English");
    expect(result!.audioTracks[1].language).toBe("VFQ");
    expect(result!.audioTracks[1].language_name).toBe("French (Québec)");
    expect(result!.subtitleTracks[0].language).toBe("en");
    expect(result!.subtitleTracks[0].language_name).toBe("English");
  });

  it("returns null for malformed JSON", () => {
    const result = parseMediaInfoJson("{not valid json", "/media/test.mkv");
    expect(result).toBeNull();
  });

  it("returns null when mediainfo output has no tracks", () => {
    const result = parseMediaInfoJson(
      JSON.stringify({ media: {} }),
      "/media/test.mkv",
    );
    expect(result).toBeNull();
  });
});
