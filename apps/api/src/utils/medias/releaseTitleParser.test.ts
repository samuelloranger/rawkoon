import { describe, expect, test } from "bun:test";
import { parseReleaseTitle } from "@rawkoon/api/utils/medias/filenameParser";

describe("parseReleaseTitle", () => {
  const cases: { title: string; exp: ReturnType<typeof parseReleaseTitle> }[] =
    [
      // ── Existing cases ──────────────────────────────────────────────────────────────────────
      {
        title: "Movie.Title.2024.1080p.BluRay.x265.HDR10.DTS-HD-GROUP",
        exp: {
          resolution: 1080,
          source: "BluRay",
          codec: "x265",
          hdr: "HDR10",
          audio: "DTS-HD",
          group: "GROUP",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Show.S01E01.2160p.WEB-DL.DV.H265-NTb",
        exp: {
          resolution: 2160,
          source: "WEB-DL",
          codec: "x265",
          hdr: "DV",
          audio: null,
          group: "NTb",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Film.2023.720p.WEBRip.x264.AAC-RARBG",
        exp: {
          resolution: 720,
          source: "WEBRip",
          codec: "x264",
          hdr: null,
          audio: "AAC",
          group: "RARBG",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Release.1080p.REMUX.AVC.DTS-X-FOO",
        exp: {
          resolution: 1080,
          source: "REMUX",
          codec: "x264",
          hdr: null,
          audio: "DTS-X",
          group: "FOO",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "4K.UHD.Movie.2022.HDR10+.TrueHD.Atmos-SPK",
        exp: {
          resolution: 2160,
          source: null,
          codec: null,
          hdr: "HDR10+",
          audio: "TrueHD Atmos",
          group: "SPK",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "HDTV.Show.S02E05.XviD.MP3-LOL",
        exp: {
          resolution: null,
          source: "HDTV",
          codec: "XviD",
          hdr: null,
          audio: "MP3",
          group: "LOL",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "DVDrip.Old.Film.480p.DivX.AC3-TEAM",
        exp: {
          resolution: 480,
          source: "DVDRip",
          codec: "DivX",
          hdr: null,
          audio: "AC3",
          group: "TEAM",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        // "-NF" suffix: parseStreamingService matches \bNF\b at end of string —
        // known false-positive when NF is the release group abbreviation.
        title: "Streaming.Title.1080p.WEB.EAC3.5.1-NF",
        exp: {
          resolution: 1080,
          source: "WEB",
          codec: null,
          hdr: null,
          audio: "EAC3",
          group: "NF",
          streaming: "NF",
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Sample.Movie.2021.1080p.BluRay.x264-GROUP",
        exp: {
          resolution: 1080,
          source: "BluRay",
          codec: "x264",
          hdr: null,
          audio: null,
          group: "GROUP",
          streaming: null,
          isSample: true,
          isProper: false,
        },
      },
      {
        title: "AV1.2024.1080p.WEB-DL.Opus-YIFY",
        exp: {
          resolution: 1080,
          source: "WEB-DL",
          codec: "AV1",
          hdr: null,
          audio: "Opus",
          group: "YIFY",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "BDRip.Movie.720p.H264.AAC-EXT",
        exp: {
          resolution: 720,
          source: "BluRay",
          codec: "x264",
          hdr: null,
          audio: "AAC",
          group: "EXT",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "BDREMUX.1080p.LPCM-FGT",
        exp: {
          resolution: 1080,
          source: "REMUX",
          codec: null,
          hdr: null,
          audio: "PCM",
          group: "FGT",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "WEBDL.NoHyphen.1080p.HEVC.DDP5.1-NTG",
        exp: {
          resolution: 1080,
          source: "WEB-DL",
          codec: "x265",
          hdr: null,
          audio: "EAC3",
          group: "NTG",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Scene.P2P.2020.1080i.HDTV.MPEG2-DSR",
        exp: {
          resolution: 1080,
          source: "HDTV",
          codec: null,
          hdr: null,
          audio: null,
          group: "DSR",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "French.Release.1080p.WEB-DL.DDP5.1.H264-QTZ",
        exp: {
          resolution: 1080,
          source: "WEB-DL",
          codec: "x264",
          hdr: null,
          audio: "EAC3",
          group: "QTZ",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Minimal-NoTechTokens",
        exp: {
          resolution: null,
          source: null,
          codec: null,
          hdr: null,
          audio: null,
          group: "NoTechTokens",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "HLG.Broadcast.1080p.HLG.H264-UKTV",
        exp: {
          resolution: 1080,
          source: null,
          codec: "x264",
          hdr: "HLG",
          audio: null,
          group: "UKTV",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Dolby.Vision.Title.2160p.WEB-DL.DDP5.1.H265-SiC",
        exp: {
          resolution: 2160,
          source: "WEB-DL",
          codec: "x265",
          hdr: "DV",
          audio: "EAC3",
          group: "SiC",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "FLAC.Audiophile.1080p.BluRay.FLAC-PTer",
        exp: {
          resolution: 1080,
          source: "BluRay",
          codec: null,
          hdr: null,
          audio: "FLAC",
          group: "PTer",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "UHD.BluRay.2023.COMPLETE.BLURAY-CoRA",
        exp: {
          resolution: 2160,
          source: "BluRay",
          codec: null,
          hdr: null,
          audio: null,
          group: "CoRA",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "WEBRip.x265.1080p.EAC3-PSA",
        exp: {
          resolution: 1080,
          source: "WEBRip",
          codec: "x265",
          hdr: null,
          audio: "EAC3",
          group: "PSA",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },

      // ── PROPER / REPACK ─────────────────────────────────────────────────────────────────────
      {
        title: "Show.S01E01.PROPER.1080p.BluRay.x264-GROUP",
        exp: {
          resolution: 1080,
          source: "BluRay",
          codec: "x264",
          hdr: null,
          audio: null,
          group: "GROUP",
          streaming: null,
          isSample: false,
          isProper: true,
        },
      },
      {
        title: "Movie.2024.REPACK.2160p.WEB-DL.HEVC.DDP5.1-NTb",
        exp: {
          resolution: 2160,
          source: "WEB-DL",
          codec: "x265",
          hdr: null,
          audio: "EAC3",
          group: "NTb",
          streaming: null,
          isSample: false,
          isProper: true,
        },
      },
      {
        title: "Show.S03E08.RERIP.720p.HDTV.x264-LOL",
        exp: {
          resolution: 720,
          source: "HDTV",
          codec: "x264",
          hdr: null,
          audio: null,
          group: "LOL",
          streaming: null,
          isSample: false,
          isProper: true,
        },
      },

      // ── HDLight (French compressed BluRay re-encode) ─────────────────────────────────────────
      {
        title: "Film.2024.1080p.BluRay.HDLight.x264.AC3-GROUP",
        exp: {
          resolution: 1080,
          source: "HDLight",
          codec: "x264",
          hdr: null,
          audio: "AC3",
          group: "GROUP",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Serie.S01E01.1080p.HDLight.MULTI.x265-GROUP",
        exp: {
          resolution: 1080,
          source: "HDLight",
          codec: "x265",
          hdr: null,
          audio: null,
          group: "GROUP",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },

      // ── HDRip ───────────────────────────────────────────────────────────────────────────────
      {
        title: "Old.Show.720p.HDRip.x264.AAC-RiPPED",
        exp: {
          resolution: 720,
          source: "HDRip",
          codec: "x264",
          hdr: null,
          audio: "AAC",
          group: "RiPPED",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },

      // ── Streaming service mid-title ─────────────────────────────────────────────────────────
      {
        title: "Show.S02E03.AMZN.WEB-DL.1080p.H264-GROUP",
        exp: {
          resolution: 1080,
          source: "WEB-DL",
          codec: "x264",
          hdr: null,
          audio: null,
          group: "GROUP",
          streaming: "AMZN",
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Movie.2024.NF.WEB-DL.1080p.x265.DDP5.1-CTRLHDs",
        exp: {
          resolution: 1080,
          source: "WEB-DL",
          codec: "x265",
          hdr: null,
          audio: "EAC3",
          group: "CTRLHDs",
          streaming: "NF",
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Show.S01.DSNP.WEB-DL.2160p.HDR.H265-GROUP",
        exp: {
          resolution: 2160,
          source: "WEB-DL",
          codec: "x265",
          hdr: "HDR10",
          audio: null,
          group: "GROUP",
          streaming: "DSNP",
          isSample: false,
          isProper: false,
        },
      },

      // ── DOVI variant of Dolby Vision ────────────────────────────────────────────────────────
      {
        title: "Movie.2023.2160p.WEB-DL.DOVI.H265.DDP5.1-GROUP",
        exp: {
          resolution: 2160,
          source: "WEB-DL",
          codec: "x265",
          hdr: "DV",
          audio: "EAC3",
          group: "GROUP",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },

      // ── VC-1 codec ──────────────────────────────────────────────────────────────────────────
      {
        title: "Old.Film.2006.1080p.BluRay.VC-1.DTS-FGT",
        exp: {
          resolution: 1080,
          source: "BluRay",
          codec: "VC-1",
          hdr: null,
          audio: "DTS",
          group: "FGT",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },

      // ── PROPER + streaming service combined ─────────────────────────────────────────────────
      {
        title: "Show.S01E01.PROPER.AMZN.WEB-DL.1080p.x265-NTb",
        exp: {
          resolution: 1080,
          source: "WEB-DL",
          codec: "x265",
          hdr: null,
          audio: null,
          group: "NTb",
          streaming: "AMZN",
          isSample: false,
          isProper: true,
        },
      },

      // ── UHD source with explicit 1080p encode — explicit resolution wins over UHD marker ─────
      {
        title:
          "Kick-Ass.2010.PROPER.UHD.BluRay.1080p.DD+Atmos.5.1.DoVi.HDR10.x265-SM737",
        exp: {
          resolution: 1080,
          source: "BluRay",
          codec: "x265",
          hdr: "DV",
          audio: "EAC3",
          group: "SM737",
          streaming: null,
          isSample: false,
          isProper: true,
        },
      },

      // ── UHD with no explicit resolution falls back to 2160 ──────────────────────────────────
      {
        title: "Movie.2022.UHD.BluRay.HDR10.TrueHD.x265-GROUP",
        exp: {
          resolution: 2160,
          source: "BluRay",
          codec: "x265",
          hdr: "HDR10",
          audio: "TrueHD",
          group: "GROUP",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },

      // ── Dot-delimited release group (French scene convention) ────────────────────────────────
      {
        title: "Elemental.2023.MULTi-VF2.1080p.WEB.x264.AC3.JAQC",
        exp: {
          resolution: 1080,
          source: "WEB",
          codec: "x264",
          hdr: null,
          audio: "AC3",
          group: "JAQC",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Movie.2023.MULTI.1080p.BluRay.x265.DTS.AZERTY",
        exp: {
          resolution: 1080,
          source: "BluRay",
          codec: "x265",
          hdr: null,
          audio: "DTS",
          group: "AZERTY",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
      {
        title: "Film.2022.TRUEFRENCH.720p.WEBRip.x264.AAC.FW",
        exp: {
          resolution: 720,
          source: "WEBRip",
          codec: "x264",
          hdr: null,
          audio: "AAC",
          group: "FW",
          streaming: null,
          isSample: false,
          isProper: false,
        },
      },
    ];

  for (const { title, exp } of cases) {
    test(title.slice(0, 60), () => {
      expect(parseReleaseTitle(title)).toEqual(exp);
    });
  }
});
