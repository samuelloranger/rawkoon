import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const VIDEO_EXT = new Set([".mkv", ".mp4", ".avi", ".m4v"]);

const EXCLUDED_DIR_NAMES = new Set([
  "sample",
  "extras",
  "bonus",
  "featurettes",
  "behind the scenes",
]);

function isExcludedDir(name: string): boolean {
  return EXCLUDED_DIR_NAMES.has(name.trim().toLowerCase());
}

export async function listVideoFilesUnder(rootPath: string): Promise<string[]> {
  const st = await stat(rootPath);
  if (st.isFile()) {
    const ext = extname(rootPath).toLowerCase();
    return VIDEO_EXT.has(ext) ? [rootPath] : [];
  }
  if (st.isDirectory()) {
    return collectVideosFromDir(rootPath);
  }
  return [];
}

async function collectVideosFromDir(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (isExcludedDir(ent.name)) continue;
      found.push(...(await collectVideosFromDir(full)));
    } else if (ent.isFile()) {
      const ext = extname(ent.name).toLowerCase();
      if (VIDEO_EXT.has(ext)) found.push(full);
    }
  }
  return found;
}

async function largestVideo(paths: string[]): Promise<string | null> {
  if (!paths.length) return null;
  let best: string | null = null;
  let bestSize = -1n;
  for (const p of paths) {
    try {
      const s = await stat(p);
      if (!s.isFile()) continue;
      const sz = BigInt(s.size);
      if (sz > bestSize) {
        bestSize = sz;
        best = p;
      }
    } catch {
      // skip unreadable
    }
  }
  return best;
}

/**
 * Resolve the primary video file for a completed torrent (single file or folder).
 */
export async function findVideoFile(
  torrentPath: string,
): Promise<string | null> {
  const st = await stat(torrentPath);
  if (st.isFile()) {
    const ext = extname(torrentPath).toLowerCase();
    return VIDEO_EXT.has(ext) ? torrentPath : null;
  }
  if (st.isDirectory()) {
    const videos = await collectVideosFromDir(torrentPath);
    return largestVideo(videos);
  }
  return null;
}
