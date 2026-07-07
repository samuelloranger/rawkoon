import { parseMediaInfoJson } from "./mediainfoParser";

export type {
  AudioTrack,
  SubtitleTrack,
  MediaFileData,
  MediaInfoTrack,
} from "./mediainfoParser";

// ─── Path remapping ───────────────────────────────────────────────────────────

/**
 * Remap an arr-internal path to the actual filesystem path visible in this container.
 * Controlled by MEDIA_PATH_REMAP env var: "from:to" pairs separated by commas.
 * Falls back to the MEDIA_PATH_FROM / MEDIA_PATH_TO pair for simple single-mapping.
 */
export function remapPath(filePath: string): string {
  const from = Bun.env.MEDIA_PATH_FROM;
  const to = Bun.env.MEDIA_PATH_TO;
  if (from && to && filePath.startsWith(from)) {
    return to + filePath.slice(from.length);
  }
  const remap = Bun.env.MEDIA_PATH_REMAP;
  if (remap) {
    for (const pair of remap.split(",")) {
      const [f, t] = pair.split(":");
      if (f && t && filePath.startsWith(f)) {
        return t + filePath.slice(f.length);
      }
    }
  }
  return filePath;
}

// ─── Subprocess layer ─────────────────────────────────────────────────────────

async function runMediaInfo(
  bin: string,
  resolvedPath: string,
): Promise<string | null> {
  const proc = Bun.spawn([bin, "--Output=JSON", resolvedPath], {
    stderr: "ignore",
  });
  const timeoutId = setTimeout(() => proc.kill(), 30_000);
  const raw = await new Response(proc.stdout).text();
  clearTimeout(timeoutId);
  const exitCode = await proc.exited;
  return exitCode !== 0 || !raw.trim() ? null : raw;
}

/**
 * Scan a video file using the `mediainfo` CLI and return structured metadata.
 * Returns null if `mediainfo` is not installed or the scan fails — never throws.
 * Applies MEDIA_PATH_FROM/MEDIA_PATH_TO remapping before scanning.
 */
export async function scanMediaInfo(
  filePath: string,
): Promise<import("./mediainfoParser").MediaFileData | null> {
  try {
    const bin = Bun.which("mediainfo");
    if (!bin) {
      console.warn(
        "[mediainfoScanner] mediainfo binary not found — skipping scan",
      );
      return null;
    }

    const resolvedPath = remapPath(filePath);
    const raw = await runMediaInfo(bin, resolvedPath);
    if (!raw) return null;

    return parseMediaInfoJson(raw, filePath);
  } catch (err) {
    console.error("[mediainfoScanner] Scan failed:", err);
    return null;
  }
}
