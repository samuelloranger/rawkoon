import type { ReleaseTitleCase } from "./releaseTitleParser.cases";

export const releaseTitleCasesB: ReleaseTitleCase[] = [
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
