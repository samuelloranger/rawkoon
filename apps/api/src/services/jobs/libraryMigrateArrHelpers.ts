import { normalizeLanguageCode } from "@rawkoon/shared";
import {
  parseFilenameMetadata,
  refineFrenchAudioLabel,
  expandLanguageCode,
} from "@rawkoon/api/utils/medias/filenameParser";

export function normalizeVideoCodec(c: string | undefined): string | null {
  if (!c) return null;
  const m: Record<string, string> = {
    h265: "HEVC",
    x265: "HEVC",
    h264: "AVC",
    x264: "AVC",
    av1: "AV1",
    xvid: "XviD",
    divx: "DivX",
    mpeg2: "MPEG-2",
    vc1: "VC-1",
  };
  return m[c.toLowerCase()] ?? c;
}

export function normalizeHdrFormat(d: string | undefined): string | null {
  if (!d) return null;
  const m: Record<string, string> = {
    HDR: "HDR10",
    HDR10: "HDR10",
    HDR10Plus: "HDR10+",
    DolbyVision: "Dolby Vision",
    HLG: "HLG",
  };
  return m[d] ?? null;
}

export function parseChannelsLayout(n: number): string {
  if (n === 1) return "mono";
  if (n === 2) return "stereo";
  if (n === 6) return "5.1";
  if (n === 8) return "7.1";
  return `${n}ch`;
}

export function fileQualityScore(f: {
  resolution?: number | null;
  hdrFormat?: string | null;
  bitDepth?: number | null;
}): number {
  return (
    (f.resolution ?? 0) * 10 +
    (f.hdrFormat ? 1000 : 0) +
    ((f.bitDepth ?? 8) >= 10 ? 100 : 0)
  );
}

/**
 * Build audio tracks from Radarr/Sonarr flat mediaInfo fields + filename flags.
 * If `arrLanguages` is provided (movieFile.languages[]), use it as source of truth.
 */
export function buildAudioTracksFromArr(
  mediaInfo: {
    audioLanguages?: string;
    audioCodec?: string;
    audioChannels?: number;
  },
  fileName: string,
  arrLanguages?: Array<{ id: number; name: string }>,
): object[] {
  const fnData = parseFilenameMetadata(fileName);

  const languages: string[] =
    arrLanguages && arrLanguages.length > 0
      ? arrLanguages.map((l) => l.name)
      : (mediaInfo.audioLanguages ?? "")
          .split("/")
          .map((s) => s.trim())
          .filter(Boolean);

  if (!languages.length) return [];

  let frenchIdx = 0;
  return languages.map((lang, i) => {
    const isoLang = normalizeLanguageCode(lang) || "und";
    const isFrench =
      /^(fre|fra|fr|french)$/i.test(isoLang) || /french/i.test(lang);

    let finalLang = isoLang;
    let finalName: string;
    if (isFrench) {
      const refined = refineFrenchAudioLabel(
        lang,
        null,
        fnData.audioFlags,
        frenchIdx++,
      );
      finalLang = refined.language;
      finalName = refined.language_name;
    } else {
      finalName =
        expandLanguageCode(isoLang) !== isoLang
          ? expandLanguageCode(isoLang)
          : lang;
    }

    return {
      index: i,
      language: finalLang,
      language_name: finalName,
      title: null,
      codec: i === 0 ? (mediaInfo.audioCodec ?? null) : null,
      channels: i === 0 ? (mediaInfo.audioChannels ?? null) : null,
      channel_layout:
        i === 0 && mediaInfo.audioChannels
          ? parseChannelsLayout(mediaInfo.audioChannels)
          : null,
      bitrate_kbps: null,
      default: i === 0,
      forced: false,
    };
  });
}

export function buildSubtitleTracksFromArr(mediaInfo: {
  subtitles?: string;
}): object[] {
  return (mediaInfo.subtitles ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((lang, i) => {
      const normalized = normalizeLanguageCode(lang) || "und";
      return {
        index: i,
        language: normalized,
        language_name: expandLanguageCode(normalized) || lang,
        title: null,
        format: null,
        forced: false,
        hearing_impaired: false,
      };
    });
}

const TMDB_BASE = "https://api.themoviedb.org/3";

export async function tmdbFetch<T>(
  path: string,
  apiKey: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${TMDB_BASE}/${path}`);
  url.searchParams.set("api_key", apiKey);
  if (params)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`TMDB ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export function pickDigitalRelease(
  results: Array<{
    iso_3166_1: string;
    release_dates: Array<{ type: number; release_date: string }>;
  }>,
  region: string,
): Date | null {
  for (const country of [region, ...results.map((r) => r.iso_3166_1)]) {
    const entry = results.find((r) => r.iso_3166_1 === country);
    const digital = entry?.release_dates.find((d) => d.type === 4);
    if (digital) return new Date(digital.release_date);
  }
  return null;
}
