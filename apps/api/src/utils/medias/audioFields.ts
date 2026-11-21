import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";

// mediainfoParser already emits release-style labels; these are its stragglers.
const CODEC_LABELS: Record<string, string> = {
  "AC-3": "AC3",
  "E-AC-3": "EAC3",
  "EAC-3": "EAC3",
  "DTS:X": "DTS-X",
  "MPEG Audio": "MP3",
};

/** Stored tracks, skipping anything that isn't a track object (old or hand-edited rows). */
export function tracksOf(audioTracks: unknown): LibraryAudioTrack[] {
  return Array.isArray(audioTracks)
    ? (audioTracks.filter(
        (t) => t != null && typeof t === "object",
      ) as LibraryAudioTrack[])
    : [];
}

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
}): { languageTags?: string[]; audioFormat?: string } {
  const tracks = tracksOf(row.audioTracks);
  if (tracks.length === 0) return {};
  const out: { languageTags?: string[]; audioFormat?: string } = {};
  if (row.languageTags.length === 0) {
    // No name hint: a renamed file carries the title, and a title like
    // "Men in Black: International" would read as a VFI release.
    const tags = classifyLanguageTags(tracks, null);
    if (tags.length > 0) out.languageTags = tags;
  }
  if (row.audioFormat == null) {
    const format = audioFormatFromTracks(tracks);
    if (format) out.audioFormat = format;
  }
  return out;
}
