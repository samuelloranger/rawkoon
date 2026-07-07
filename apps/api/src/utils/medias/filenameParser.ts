import { normalizeLanguageCode } from "@rawkoon/shared";

// ─── Output type ─────────────────────────────────────────────────────────────

export interface FilenameMetadata {
  resolution: number | null;
  source: string | null;
  hdrFormat: string | null;
  videoCodec: string | null;
  audioFormat: string | null;
  audioChannels: string | null;
  /** French/multilingual audio flags found in the filename */
  audioFlags: string[];
  releaseGroup: string | null;
  edition: string | null;
  streaming: string | null; // AMZN, NF, DSNP, APLE, etc.
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VIDEO_EXT = /\.(mkv|avi|mp4|m4v|wmv|ts|m2ts|mov|flv)$/i;
const TECHNICAL_TOKENS =
  /^(2160p|1080p|1080i|720p|480p|576p|4K|UHD|WEB|WEB[-.]?DL|WEBRip|BluRay|BDRip|BDRemux|HDRip|DVDRip|HDTV|REMUX|HDLight|x264|x265|H264|H265|HEVC|AVC|AV1|VP9|AAC|AC3|EAC3|DTS|FLAC|TrueHD|MULTI|MULTi|VFF|VFQ|VFI|VF2|VF|FRENCH|TRUEFRENCH|VOSTFR|ATMOS|HDR|HDR10|DV)$/i;

// ─── Individual parsers ───────────────────────────────────────────────────────

export function parseResolution(filename: string): number | null {
  if (/\b(4K|UHD|2160[pi])\b/i.test(filename)) return 2160;
  if (/\b1080[pi]\b/i.test(filename)) return 1080;
  if (/\b720p\b/i.test(filename)) return 720;
  if (/\b576p\b/i.test(filename)) return 576;
  if (/\b480p\b/i.test(filename)) return 480;
  return null;
}

export function parseSource(filename: string): string | null {
  // Order matters: more specific patterns first
  if (/\bBD[-.]?REMUX\b|\bBDREMUX\b|\bREMUX\b/i.test(filename)) return "REMUX";
  if (/\bHDLight\b/i.test(filename)) return "HDLight";
  if (/\bBlu[-.]?ray\b|\bBLURAY\b|\bBDRip\b/i.test(filename)) return "BluRay";
  if (/\bWEB[-.]?DL\b/i.test(filename)) return "WEB-DL";
  if (/\bWEB[-.]?Rip\b/i.test(filename)) return "WEBRip";
  if (/\bHDTV\b/i.test(filename)) return "HDTV";
  if (/\bDVD[-.]?Rip\b|\bDVDRip\b/i.test(filename)) return "DVDRip";
  if (/\bHD[-.]?CAM\b/i.test(filename)) return "HDCAM";
  if (/\bHDRip\b/i.test(filename)) return "HDRip";
  // Generic WEB (must be last to not match WEB-DL/WEBRip)
  if (/\bWEB\b/i.test(filename)) return "WEB";
  return null;
}

export function parseStreamingService(filename: string): string | null {
  if (/\bAMZN\b|\bAmazon\b/i.test(filename)) return "AMZN";
  if (/\bNFLX\b|\bNF\b(?!\w)|\bNetflix\b/i.test(filename)) return "NF";
  if (/\bDSNP\b|\bDisney\b/i.test(filename)) return "DSNP";
  if (/\bAPLE\b|\bAPTV\b|\bApple\b/i.test(filename)) return "APLE";
  if (/\bHMAX\b|\bHBO[-.]?Max\b/i.test(filename)) return "HMAX";
  if (/\bHULU\b/i.test(filename)) return "HULU";
  if (/\bPCOK\b|\bPeacock\b/i.test(filename)) return "PCOK";
  if (/\bPAMC\b|\bParamount\b/i.test(filename)) return "PAMC";
  if (/\bCRAV\b|\bCrave\b/i.test(filename)) return "CRAV";
  if (/\bTVER\b|\bTVA\b/i.test(filename)) return "TVER";
  return null;
}

export function parseHdrFormat(filename: string): string | null {
  // Dolby Vision first (most specific)
  if (/\bDolby\.?Vision\b|\bDOVi\b(?!\w)|\bDV\b(?!\w)/i.test(filename))
    return "Dolby Vision";
  // HDR10+ before HDR10
  if (/\bHDR10\+\b|\bHDR10Plus\b|\bHDR10\s*Plus\b/i.test(filename))
    return "HDR10+";
  if (/\bHDR10\b/i.test(filename)) return "HDR10";
  if (/\bHDR\b/i.test(filename)) return "HDR10";
  if (/\bHLG\b/i.test(filename)) return "HLG";
  if (/\b10.?bit\b/i.test(filename)) return "HDR10"; // best guess for 10-bit without explicit HDR tag
  return null;
}

export function parseVideoCodec(filename: string): string | null {
  if (/\bx?265\b|\bHEVC\b|\bH\.?265\b/i.test(filename)) return "HEVC";
  if (/\bx?264\b|\bAVC\b|\bH\.?264\b/i.test(filename)) return "AVC";
  if (/\bAV1\b/i.test(filename)) return "AV1";
  if (/\bVP9\b/i.test(filename)) return "VP9";
  if (/\bXviD\b/i.test(filename)) return "XviD";
  if (/\bDivX\b/i.test(filename)) return "DivX";
  if (/\bMPEG[-.]?2\b/i.test(filename)) return "MPEG-2";
  if (/\bVC[-.]?1\b/i.test(filename)) return "VC-1";
  return null;
}

export function parseAudioFormat(filename: string): string | null {
  // Most specific first
  if (/\bTrueHD\b.*\bAtmos\b|\bAtmos\b.*\bTrueHD\b/i.test(filename))
    return "TrueHD Atmos";
  if (/\bTrueHD\b/i.test(filename)) return "TrueHD";
  if (/\bDTS[-.]?HD[-.]?MA\b|\bDTS[-.]?MA\b/i.test(filename))
    return "DTS-HD MA";
  if (/\bDTS[-.]?X\b/i.test(filename)) return "DTS-X";
  if (/\bDTS[-.]?HD\b/i.test(filename)) return "DTS-HD";
  if (/\bDTS\b/i.test(filename)) return "DTS";
  if (
    /\bEAC[-.]?3\b|\bDD\s*\+\b|\bDolby\s*Digital\s*Plus\b|\bDDP\b/i.test(
      filename,
    )
  )
    return "EAC3";
  if (/\bDD\b(?!\+)|\bAC[-.]?3\b|\bDolby\s*Digital\b/i.test(filename))
    return "AC3";
  if (/\bAAC\b/i.test(filename)) return "AAC";
  if (/\bFLAC\b/i.test(filename)) return "FLAC";
  if (/\bOPUS\b/i.test(filename)) return "Opus";
  if (/\bMP3\b/i.test(filename)) return "MP3";
  if (/\bPCM\b/i.test(filename)) return "PCM";
  return null;
}

export function parseAudioChannels(filename: string): string | null {
  if (/\b7\.1\b/.test(filename)) return "7.1";
  if (/\b5\.1\b/.test(filename)) return "5.1";
  if (/\b2\.0\b|\bstereo\b/i.test(filename)) return "stereo";
  if (/\bmono\b/i.test(filename)) return "mono";
  return null;
}

/**
 * Detect French/multilingual audio flags from filename.
 * Returns ordered list, e.g. ["MULTI", "VFF"] or ["TRUEFRENCH"] or [].
 */
export function parseAudioFlags(filename: string): string[] {
  const n = filename.toUpperCase();
  const flags: string[] = [];

  // MULTI + qualifier
  const hasMulti = /\bMULTI\b/.test(n);
  if (hasMulti) flags.push("MULTI");

  // VF2 = VFF + VFQ combo in some releases
  if (/\bMULTI[-.]?VF2\b|\bVF2\b/.test(n)) {
    flags.push("VF2");
    return flags; // signals both VFF+VFQ, don't add separately
  }

  // Specific French variants — only match themselves, not the generic "fr"
  if (/\bTRUEFRENCH\b/.test(n)) flags.push("TRUEFRENCH");
  if (/\bVFF\b/.test(n)) flags.push("VFF");
  if (/\bVFQ\b|\bVQC\b/.test(n)) flags.push("VFQ");
  if (/\bVFI\b/.test(n)) flags.push("VFI");
  // Generic VF / FRENCH — these emit "fr" so the generic "Français" preference catches them
  if (
    /\bVF\b/.test(n) &&
    !flags.some((f) => ["VFF", "VFQ", "VFI", "VF2", "TRUEFRENCH"].includes(f))
  ) {
    flags.push("VF");
    flags.push("fr");
  }
  if (/\bFRENCH\b/.test(n) && !flags.length) {
    flags.push("FRENCH");
    flags.push("fr");
  }
  if (/\bVOSTFR\b/.test(n)) flags.push("VOSTFR");
  if (/\bVFSTFR\b/.test(n)) flags.push("VFSTFR");

  // Generic ISO language codes — for releases that label audio tracks explicitly
  if (/\bENGLISH\b|\bENG\b/.test(n)) flags.push("en");
  if (/\bGERMAN\b|\bDEUTSCH\b|\bGER\b/.test(n)) flags.push("de");
  if (/\bSPANISH\b|\bESPANOL\b|\bSPA\b/.test(n)) flags.push("es");
  if (/\bITALIAN\b|\bITA\b/.test(n)) flags.push("it");
  if (/\bJAPANESE\b|\bJPN\b/.test(n)) flags.push("ja");
  if (/\bPORTUGUESE\b|\bPOR\b/.test(n)) flags.push("pt");

  return flags;
}

export function parseEdition(filename: string): string | null {
  if (/\bExtended\b/i.test(filename)) return "Extended";
  if (/\bDirector'?s?\s*Cut\b/i.test(filename)) return "Director's Cut";
  if (/\bTheatrical\b/i.test(filename)) return "Theatrical";
  if (/\bUnrated\b/i.test(filename)) return "Unrated";
  if (/\bRemastered\b/i.test(filename)) return "Remastered";
  if (/\bCriterion\b/i.test(filename)) return "Criterion";
  if (/\bIntégrale\b|\bIntegrale\b|\bComplete\b/i.test(filename))
    return "Intégrale";
  return null;
}

export function parseReleaseGroup(filename: string): string | null {
  const withoutExt = filename.replace(VIDEO_EXT, "").trim();
  // Remove trailing brackets e.g. "[GROUP]"
  const withoutBrackets = withoutExt.replace(/\s*[([][^)\]]*[)\]]$/, "");
  const match = withoutBrackets.match(/-([A-Za-z0-9_]+)$/);
  if (!match) return null;
  // Skip if it's a technical token
  if (TECHNICAL_TOKENS.test(match[1])) return null;
  return match[1];
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export function parseFilenameMetadata(filename: string): FilenameMetadata {
  return {
    resolution: parseResolution(filename),
    source: parseSource(filename),
    hdrFormat: parseHdrFormat(filename),
    videoCodec: parseVideoCodec(filename),
    audioFormat: parseAudioFormat(filename),
    audioChannels: parseAudioChannels(filename),
    audioFlags: parseAudioFlags(filename),
    releaseGroup: parseReleaseGroup(filename),
    edition: parseEdition(filename),
    streaming: parseStreamingService(filename),
  };
}

// ─── Prowlarr / release title (scene names, no file extension) ───────────────

export interface ParsedRelease {
  resolution: 480 | 720 | 1080 | 2160 | null;
  source: string | null;
  codec: string | null;
  hdr: string | null;
  audio: string | null;
  group: string | null;
  streaming: string | null;
  isSample: boolean;
  isProper: boolean;
}

const RES_TITLE_RES = /\b(2160p|4K|UHD|1080p|1080i|720p|480p|576p)\b/i;

export function parseReleaseResolution(
  title: string,
): 480 | 720 | 1080 | 2160 | null {
  // Explicit pixel-count tokens take priority over generic UHD/4K markers.
  // "UHD BluRay 1080p" is a 1080p encode sourced from a UHD disc — resolution is 1080p.
  if (/\b2160p\b/i.test(title)) return 2160;
  if (/\b1080[pi]\b/i.test(title)) return 1080;
  if (/\b720p\b/i.test(title)) return 720;
  if (/\b480p\b/i.test(title) || /\b576p\b/i.test(title)) return 480;
  // Fall back to generic markers only when no explicit resolution is present
  if (/\b(4K|UHD)\b/i.test(title)) return 2160;
  return null;
}

/** Order matters: REMUX before BluRay, HDLight before BluRay, WEB-DL before WEB */
export function parseReleaseSource(title: string): string | null {
  if (/\bREMUX\b|\bBDREMUX\b|\bBD[-.]?REMUX\b/i.test(title)) return "REMUX";
  // HDLight: French re-encode from BluRay — check before generic BluRay
  if (/\bHDLight\b/i.test(title)) return "HDLight";
  if (/\bBlu[-.]?ray\b|\bBLURAY\b|\bBDRip\b|\bBRRip\b/i.test(title))
    return "BluRay";
  if (/\bWEB[-.]?DL\b|\bWEBDL\b/i.test(title)) return "WEB-DL";
  if (/\bWEBRip\b|\bWEB[-.]?Rip\b/i.test(title)) return "WEBRip";
  if (/\bHDRip\b/i.test(title)) return "HDRip";
  if (/\bHDTV\b/i.test(title)) return "HDTV";
  if (/\bDVDRip\b|\bDVD\b/i.test(title)) return "DVDRip";
  if (/\bWEB\b/i.test(title)) return "WEB";
  return null;
}

export function parseReleaseCodec(title: string): string | null {
  if (/\bx265\b|\bH\.?265\b|\bH265\b|\bHEVC\b/i.test(title)) return "x265";
  if (/\bx264\b|\bH\.?264\b|\bH264\b|\bAVC\b/i.test(title)) return "x264";
  if (/\bAV1\b/i.test(title)) return "AV1";
  if (/\bVC[-.]?1\b/i.test(title)) return "VC-1";
  if (/\bXviD\b/i.test(title)) return "XviD";
  if (/\bDivX\b/i.test(title)) return "DivX";
  return null;
}

export function parseReleaseHdr(title: string): string | null {
  if (/HDR10\+|HDR10Plus/i.test(title)) return "HDR10+";
  // DoVi/DOVI/DV are all Dolby Vision variants used across trackers
  if (/\bDolby\.?Vision\b|\bDoVi\b|\bDOVI\b|\bDV\b/i.test(title)) return "DV";
  if (/\bHDR10\b/i.test(title)) return "HDR10";
  if (/\bHDR\b/i.test(title)) return "HDR10";
  if (/\bHLG\b/i.test(title)) return "HLG";
  return null;
}

export function parseReleaseIsProper(title: string): boolean {
  return /\bPROPER\b|\bREPACK\b|\bREPROP\b|\bREAL\b|\bRERIP\b/i.test(title);
}

export function parseReleaseAudio(title: string): string | null {
  if (
    /\bTrueHD\.?Atmos\b|\bAtmos\b.*\bTrueHD\b|\bTrueHD\b.*\bAtmos\b/i.test(
      title,
    )
  )
    return "TrueHD Atmos";
  if (/\bTrueHD\b/i.test(title)) return "TrueHD";
  if (/\bDTS[-.]?HD\.?MA\b|\bDTS[-.]?MA\b/i.test(title)) return "DTS-HD MA";
  if (/\bDTS[-.]?X\b/i.test(title)) return "DTS-X";
  if (/\bDTS[-.]?HD\b/i.test(title)) return "DTS-HD";
  if (/\bDTS\b/i.test(title)) return "DTS";
  if (
    /\bDDP\d*\.?\d*\b|\bDD\+\d*\.?\d*\b|\bEAC3\b|\bE[-.]?AC[-.]?3\b/i.test(
      title,
    )
  )
    return "EAC3";
  if (/\bAC3\b|\bDD\b(?!\+)/i.test(title)) return "AC3";
  if (/\bAAC\b/i.test(title)) return "AAC";
  if (/\bFLAC\b/i.test(title)) return "FLAC";
  if (/\bL?PCM\b/i.test(title)) return "PCM";
  if (/\bMP3\b/i.test(title)) return "MP3";
  if (/\bOPUS\b/i.test(title)) return "Opus";
  return null;
}

/** Last segment after final hyphen (scene / P2P release group). */
export function parseReleaseGroupFromTitle(title: string): string | null {
  const trimmed = title.trim();

  // Hyphen-delimited: standard scene convention (e.g. "...x265-GROUP")
  const idx = trimmed.lastIndexOf("-");
  if (idx > 0 && idx < trimmed.length - 1) {
    const seg = trimmed.slice(idx + 1).trim();
    if (seg && seg.length <= 64 && !/\s/.test(seg) && !RES_TITLE_RES.test(seg))
      return seg;
  }

  // Dot-delimited fallback: French scene convention (e.g. "...AC3.JAQC")
  // Accept the last dot-token only if it looks like a group name:
  // - all alphanumeric, 2–16 chars
  // - not a known technical token, resolution, or video file extension
  const VIDEO_EXT_TOKEN = /^(mkv|mp4|avi|m4v|wmv|ts|m2ts|mov|flv)$/i;
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot > 0 && lastDot < trimmed.length - 1) {
    const seg = trimmed.slice(lastDot + 1).trim();
    if (
      seg.length >= 2 &&
      seg.length <= 16 &&
      /^[A-Za-z0-9]+$/.test(seg) &&
      !RES_TITLE_RES.test(seg) &&
      !TECHNICAL_TOKENS.test(seg) &&
      !VIDEO_EXT_TOKEN.test(seg)
    )
      return seg;
  }

  return null;
}

export function parseReleaseIsSample(title: string): boolean {
  return /\bSample\b/i.test(title);
}

/**
 * Extract season/episode numbers from a scene release title.
 * Matches SxxExx, xxXxx, and " Exx" forms. Returns null if neither is found.
 */
export function parseReleaseSeasonEpisode(
  title: string,
): { season: number; episode: number | null } | null {
  const sxe = title.match(/S(\d{1,2})E(\d{1,3})/i);
  if (sxe)
    return { season: parseInt(sxe[1], 10), episode: parseInt(sxe[2], 10) };
  const xForm = title.match(/(?:^|[\s._-])(\d{1,2})x(\d{1,3})(?!\d)/i);
  if (xForm)
    return { season: parseInt(xForm[1], 10), episode: parseInt(xForm[2], 10) };
  const seasonOnly = title.match(
    /(?:^|[\s._-])(?:S|Season|Saison|Stagione|Series)[\s._-]?(\d{1,2})(?![\s._-]?\d)/i,
  );
  if (seasonOnly) return { season: parseInt(seasonOnly[1], 10), episode: null };
  return null;
}

/**
 * Normalize a title for fuzzy equality: lowercase, strip diacritics, collapse
 * any non-alphanumeric run to a single space, trim. Used to compare an
 * indexer-returned release title against the expected media title.
 */
export function normalizeTitleForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Parse a raw indexer release title (Prowlarr, etc.) into structured quality fields.
 */
export function parseReleaseTitle(title: string): ParsedRelease {
  return {
    resolution: parseReleaseResolution(title),
    source: parseReleaseSource(title),
    codec: parseReleaseCodec(title),
    hdr: parseReleaseHdr(title),
    audio: parseReleaseAudio(title),
    group: parseReleaseGroupFromTitle(title),
    streaming: parseStreamingService(title),
    isSample: parseReleaseIsSample(title),
    isProper: parseReleaseIsProper(title),
  };
}

/**
 * Refine a French audio track's language label using its MediaInfo Title field
 * and filename flags (VFF, VFQ, TRUEFRENCH, etc.).
 */
export function refineFrenchAudioLabel(
  language: string,
  title: string | null,
  audioFlags: string[],
  trackIndex: number,
): { language: string; language_name: string } {
  const normalizedLanguage = normalizeLanguageCode(language);
  const rawLanguage = language.toLowerCase();
  const isFrench =
    normalizedLanguage === "fr" ||
    normalizedLanguage === "fre" ||
    normalizedLanguage === "fra" ||
    normalizedLanguage === "french";
  if (!isFrench)
    return {
      language: normalizedLanguage || "und",
      language_name: expandLanguageCode(normalizedLanguage || "und"),
    };

  if (
    rawLanguage.includes("fr-ca") ||
    rawLanguage.includes("fr_ca") ||
    rawLanguage.includes("frca")
  ) {
    return { language: "VFQ", language_name: "French (Québec)" };
  }
  if (
    rawLanguage.includes("fr-fr") ||
    rawLanguage.includes("fr_fr") ||
    rawLanguage.includes("frfr")
  ) {
    return { language: "VFF", language_name: "French (France)" };
  }

  const t = (title ?? "").toLowerCase();

  // Track title is the most reliable source
  if (/vfq|vqc|qu[eé]bec|qu[eé]b|canadien|canadian/i.test(t))
    return { language: "VFQ", language_name: "French (Québec)" };
  if (/vff|france|truefrench|europ/i.test(t))
    return { language: "VFF", language_name: "French (France)" };
  if (/vfi|international/i.test(t))
    return { language: "VFI", language_name: "French (International)" };

  // Fall back to filename flags
  if (audioFlags.includes("VF2")) {
    // VF2 = VFF + VFQ; first French track = VFF, second = VFQ
    return trackIndex === 0
      ? { language: "VFF", language_name: "French (France)" }
      : { language: "VFQ", language_name: "French (Québec)" };
  }
  if (audioFlags.includes("TRUEFRENCH"))
    return { language: "VFF", language_name: "French (TRUEFRENCH)" };
  if (audioFlags.includes("VFF"))
    return { language: "VFF", language_name: "French (France)" };
  if (audioFlags.includes("VFQ"))
    return { language: "VFQ", language_name: "French (Québec)" };
  if (audioFlags.includes("VFI"))
    return { language: "VFI", language_name: "French (International)" };

  return { language: "fra", language_name: "French" };
}

const ISO_639_2_NAMES: Record<string, string> = {
  en: "English",
  eng: "English",
  fr: "French",
  fra: "French",
  fre: "French",
  es: "Spanish",
  spa: "Spanish",
  de: "German",
  deu: "German",
  ger: "German",
  it: "Italian",
  ita: "Italian",
  pt: "Portuguese",
  por: "Portuguese",
  ja: "Japanese",
  jpn: "Japanese",
  zh: "Chinese",
  chi: "Chinese",
  zho: "Chinese",
  ko: "Korean",
  kor: "Korean",
  ru: "Russian",
  rus: "Russian",
  ar: "Arabic",
  ara: "Arabic",
  hi: "Hindi",
  hin: "Hindi",
  nl: "Dutch",
  nld: "Dutch",
  sv: "Swedish",
  swe: "Swedish",
  no: "Norwegian",
  nor: "Norwegian",
  da: "Danish",
  dan: "Danish",
  fi: "Finnish",
  fin: "Finnish",
  pl: "Polish",
  pol: "Polish",
  tr: "Turkish",
  tur: "Turkish",
  he: "Hebrew",
  heb: "Hebrew",
  th: "Thai",
  tha: "Thai",
  vi: "Vietnamese",
  vie: "Vietnamese",
  id: "Indonesian",
  ind: "Indonesian",
  ms: "Malay",
  msa: "Malay",
  cs: "Czech",
  ces: "Czech",
  cze: "Czech",
  sk: "Slovak",
  slk: "Slovak",
  hu: "Hungarian",
  hun: "Hungarian",
  ro: "Romanian",
  ron: "Romanian",
  rum: "Romanian",
  bg: "Bulgarian",
  bul: "Bulgarian",
  hr: "Croatian",
  hrv: "Croatian",
  sr: "Serbian",
  srp: "Serbian",
  uk: "Ukrainian",
  ukr: "Ukrainian",
  el: "Greek",
  ell: "Greek",
  ca: "Catalan",
  cat: "Catalan",
  und: "Unknown",
};

export function expandLanguageCode(code: string): string {
  const normalized = normalizeLanguageCode(code) || "und";
  return ISO_639_2_NAMES[normalized] ?? normalized;
}
