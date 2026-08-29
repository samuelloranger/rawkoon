/**
 * A file's duration in seconds, per ffprobe.
 *
 * The whole-book timeline is built by accumulating these, so this is the single
 * definition of how long a chapter is. It deliberately does not reuse
 * scanMediaInfo: MediaInfo and ffprobe can disagree in the third decimal, and
 * two definitions of "how long" is how a timeline silently desynchronises.
 */
export const probeAudioDuration = async (
  path: string,
): Promise<number | null> => {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const out = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) !== 0) {
    return null;
  }
  const seconds = Number(out);
  return Number.isFinite(seconds) ? seconds : null;
};
