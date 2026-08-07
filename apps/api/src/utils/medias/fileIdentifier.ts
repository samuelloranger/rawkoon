import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, extname } from "node:path";
import { mapPool } from "@rawkoon/api/utils/medias/fileFingerprint";

const VIDEO_EXT = new Set([".mkv", ".mp4", ".avi", ".m4v"]);
/** Bound concurrent readdir of sibling directories during a tree walk. */
const READDIR_CONCURRENCY = 8;
const STAT_CONCURRENCY = 16;

const EXCLUDED_DIR_NAMES = new Set([
  "sample",
  "extras",
  "bonus",
  "featurettes",
  "behind the scenes",
]);

export function isExcludedDir(name: string): boolean {
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

/**
 * BFS walk with bounded concurrent readdir of sibling directories.
 * Avoids serial depth-first readdir stalls on wide trees.
 */
async function collectVideosFromDir(rootDir: string): Promise<string[]> {
  const found: string[] = [];
  let pending = [rootDir];

  while (pending.length > 0) {
    const batch = pending;
    pending = [];
    const nested = await mapPool(batch, READDIR_CONCURRENCY, async (dir) => {
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        // Unreadable dir (permissions, vanished, etc.) — skip it.
        return { files: [] as string[], dirs: [] as string[] };
      }
      const files: string[] = [];
      const dirs: string[] = [];
      for (const ent of entries) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (!isExcludedDir(ent.name)) dirs.push(full);
        } else if (ent.isFile()) {
          const ext = extname(ent.name).toLowerCase();
          if (VIDEO_EXT.has(ext)) files.push(full);
        }
      }
      return { files, dirs };
    });
    for (const n of nested) {
      found.push(...n.files);
      pending.push(...n.dirs);
    }
  }
  return found;
}

async function largestVideo(paths: string[]): Promise<string | null> {
  if (!paths.length) return null;
  const sizes = await mapPool(paths, STAT_CONCURRENCY, async (p) => {
    try {
      const s = await stat(p);
      if (!s.isFile()) return null;
      return { path: p, size: BigInt(s.size) };
    } catch {
      return null;
    }
  });
  let best: string | null = null;
  let bestSize = -1n;
  for (const row of sizes) {
    if (!row) continue;
    if (row.size > bestSize) {
      bestSize = row.size;
      best = row.path;
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
