import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";

// mediainfoParser already emits release-style labels; these are its stragglers.
const CODEC_LABELS: Record<string, string> = {
  "AC-3": "AC3",
  "E-AC-3": "EAC3",
  "EAC-3": "EAC3",
  "DTS:X": "DTS-X",
  "MPEG Audio": "MP3",
};

/** The default-flagged track, else the first: what a player opens with. */
function mainTrack(tracks: LibraryAudioTrack[]): LibraryAudioTrack | null {
  return tracks.find((t) => t.default) ?? tracks[0] ?? null;
}

/** Audio format label for a file, from its main track's codec. */
export function audioFormatFromTracks(
  tracks: LibraryAudioTrack[],
): string | null {
  const codec = mainTrack(tracks)?.codec?.trim();
  if (!codec) return null;
  return CODEC_LABELS[codec] ?? codec;
}

/**
 * The audio fields a file row is missing, derived from tracks it already has.
 * Never overwrites: post-processing may have set sharper values from the
 * release name (VFQ vs VFF) than the tracks alone can give.
 */
export function missingAudioFields(row: {
  audioTracks: unknown;
  languageTags: string[];
  audioFormat: string | null;
  fileName: string;
}): { languageTags?: string[]; audioFormat?: string } {
  const tracks = Array.isArray(row.audioTracks)
    ? (row.audioTracks as LibraryAudioTrack[])
    : [];
  if (tracks.length === 0) return {};
  const out: { languageTags?: string[]; audioFormat?: string } = {};
  if (row.languageTags.length === 0) {
    // The file name often still carries the release's VFQ/VFF tag.
    const tags = classifyLanguageTags(tracks, row.fileName);
    if (tags.length > 0) out.languageTags = tags;
  }
  if (row.audioFormat == null) {
    const format = audioFormatFromTracks(tracks);
    if (format) out.audioFormat = format;
  }
  return out;
}
