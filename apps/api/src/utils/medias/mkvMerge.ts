import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { scanMediaInfo } from "@rawkoon/api/utils/medias/mediainfoScanner";
import type { MediaFileData } from "@rawkoon/api/utils/medias/mediainfoParser";

const MERGE_TIMEOUT_MS = 600_000;
/** Appending is lossless, so the result should equal the sum of the parts. */
const DURATION_TOLERANCE_SECS = 5;

export type TrackShape = Pick<
  MediaFileData,
  "videoCodec" | "audioTracks" | "subtitleTracks"
>;

/**
 * True when two files can be appended without silently dropping or misplacing
 * a track. mkvmerge appends by track order, so a differing layout produces a
 * file whose second half is missing audio or plays the wrong language.
 */
export function tracksCompatible(a: TrackShape, b: TrackShape): boolean {
  if (a.videoCodec !== b.videoCodec) return false;
  if (a.audioTracks.length !== b.audioTracks.length) return false;
  if (a.subtitleTracks.length !== b.subtitleTracks.length) return false;

  const langs = (tracks: Array<{ language: string }>) =>
    tracks.map((t) => t.language).join(",");

  if (langs(a.audioTracks) !== langs(b.audioTracks)) return false;
  if (langs(a.subtitleTracks) !== langs(b.subtitleTracks)) return false;
  return true;
}

/**
 * Append `parts` into `outPath` with mkvmerge, then verify the output runtime
 * equals the sum of the inputs. Returns false rather than throwing, matching
 * scanMediaInfo's contract.
 *
 * Used to rejoin a double-length episode that a streaming rip split into
 * "Part 1" / "Part 2" — see services/library/seasonPackMapping.ts.
 */
export async function mkvAppend(
  parts: string[],
  outPath: string,
): Promise<boolean> {
  if (parts.length < 2) return false;
  const bin = Bun.which("mkvmerge");
  if (!bin) {
    console.warn("[mkvMerge] mkvmerge binary not found — cannot merge");
    return false;
  }

  const expected: number[] = [];
  for (const part of parts) {
    const mi = await scanMediaInfo(part);
    if (!mi?.durationSecs) {
      console.warn(`[mkvMerge] Could not read duration of "${part}"`);
      return false;
    }
    expected.push(mi.durationSecs);
  }

  // Unlike placeFile, nothing else creates the destination directory for a
  // merge. A season whose only new file is the merged episode — or one placed
  // concurrently with its siblings — would otherwise fail on a missing parent.
  try {
    await mkdir(dirname(outPath), { recursive: true });
  } catch (e) {
    console.warn(`[mkvMerge] Could not create directory for "${outPath}":`, e);
    return false;
  }

  // mkvmerge's append syntax: mkvmerge -o out first + second [+ third...]
  const args = [bin, "-o", outPath, parts[0] as string];
  for (const part of parts.slice(1)) args.push("+", part);

  const proc = Bun.spawn(args, { stderr: "ignore", stdout: "ignore" });
  const timeoutId = setTimeout(() => proc.kill(), MERGE_TIMEOUT_MS);
  const exitCode = await proc.exited;
  clearTimeout(timeoutId);

  if (exitCode !== 0) {
    console.warn(`[mkvMerge] mkvmerge exited ${exitCode} for "${outPath}"`);
    return false;
  }

  const out = await scanMediaInfo(outPath);
  const want = expected.reduce((sum, d) => sum + d, 0);
  if (
    !out?.durationSecs ||
    Math.abs(out.durationSecs - want) > DURATION_TOLERANCE_SECS
  ) {
    console.warn(
      `[mkvMerge] "${outPath}" is ${out?.durationSecs ?? "unknown"}s, expected ~${want}s — rejecting merge`,
    );
    return false;
  }

  return true;
}
