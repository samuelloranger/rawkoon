import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { listVideoFilesUnder } from "@rawkoon/api/utils/medias/fileIdentifier";
import {
  parseReleaseSeasonEpisode,
  parseReleaseTitle,
} from "@rawkoon/api/utils/medias/filenameParser";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";

export const DOWNLOADS_MIN_BYTES = 100 * 1024 * 1024;
const MIN_BYTES = DOWNLOADS_MIN_BYTES;
const CACHE_MS = 30_000;

const RES_HINT = /\b(?:2160p|1080[pi]?|720p|480p|576p|4K|UHD)\b/i;

let cachedInodeKeySet: Set<string> | null = null;
let cachedInodeExpiresAt = 0;

/** Library inode index for hardlink detection. Cached for 30s. */
export async function buildLibraryInodeKeySet(
  refresh = false,
): Promise<Set<string>> {
  const now = Date.now();
  if (!refresh && cachedInodeKeySet && cachedInodeExpiresAt > now) {
    return cachedInodeKeySet;
  }

  const rows = await prisma.mediaFile.findMany({ select: { filePath: true } });
  const keys = new Set<string>();
  for (const row of rows) {
    try {
      const st = await stat(remapPath(row.filePath));
      if (st.isFile()) keys.add(inodeKey(st.dev, st.ino));
    } catch {
      continue;
    }
  }
  cachedInodeKeySet = keys;
  cachedInodeExpiresAt = now + CACHE_MS;
  return keys;
}

function inodeKey(
  dev: number | bigint | undefined,
  ino: number | bigint | undefined,
): string {
  if (dev === undefined || ino === undefined) return "?";
  return `${dev}:${ino}`;
}

export function deriveDownloadsScanRoots(media: {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
}): string[] {
  const roots = new Set<string>();
  const m = media.moviesLibraryPath?.trim();
  const s = media.showsLibraryPath?.trim();
  if (m) roots.add(dirname(resolve(m.replace(/\/+$/, ""))));
  if (s) roots.add(dirname(resolve(s.replace(/\/+$/, ""))));
  return [...roots];
}

/**
 * Library subtree paths that must be excluded from the Downloads walk.
 * The Downloads root is `dirname(libraryPath)`, which by definition contains
 * the library subdir — walking it naively would pick up every library file
 * and (since their inodes are in the library set) flag them all as imported.
 */
export function deriveLibraryExcludeRoots(media: {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
}): string[] {
  const out: string[] = [];
  const m = media.moviesLibraryPath?.trim();
  const s = media.showsLibraryPath?.trim();
  if (m) out.push(resolve(m.replace(/\/+$/, "")));
  if (s) out.push(resolve(s.replace(/\/+$/, "")));
  return out;
}

/** True when `candidate` resolves under `root`. */
export function pathIsInsideRoot(candidate: string, root: string): boolean {
  const c = resolve(candidate);
  const r = resolve(root);
  const prefix = r.endsWith("/") ? r : `${r}/`;
  return c === r || c.startsWith(prefix);
}

export function invalidateDownloadsScannerCache(): void {
  // No-op when already cleared: during a Submit run, every successful assign
  // would otherwise clear an already-empty cache. The first clear is the only
  // one that does work; the rest naturally collapse to nothing here.
  if (cache === undefined) return;
  cache = undefined;
}

export function invalidateLibraryInodeKeySetCache(): void {
  cachedInodeKeySet = null;
  cachedInodeExpiresAt = 0;
}

export type ScanResult = {
  entries: RawDownloadRow[];
  file_operation: "hardlink" | "move";
};

type Cached = ScanResult & { expiresAt: number };
let cache: Cached | undefined;

export type DownloadParsed = {
  title: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  quality: string | null;
  codec: string | null;
  release_group: string | null;
  hdr: string | null;
  audio: string[];
  subtitles: string[];
  kind: "movie" | "tv";
};

export type RawDownloadRow = {
  file_path: string;
  file_name: string;
  size_bytes: number;
  modified_at: string;
  dev: number;
  ino: number;
  /**
   * True when this Downloads file shares an inode with a library `MediaFile`.
   * In hardlink mode, that means it's already linked into the library. In move
   * mode, this can't happen by construction (move removes the source). The
   * field name is mode-agnostic; the UI label adapts to `file_operation`.
   */
  is_imported: boolean;
  parsed: DownloadParsed;
};

function stripSceneSuffixForTitle(stem: string): string {
  let s = stem.trim();
  s = s.replace(/\bSample\b.*$/i, "");
  const lastHyphen = s.lastIndexOf("-");
  if (lastHyphen > 2 && lastHyphen < s.length - 2) {
    const tail = s.slice(lastHyphen + 1);
    if (
      !RES_HINT.test(tail) &&
      /^[\dA-Za-z]+$/.test(tail) &&
      tail.length <= 48
    ) {
      s = s.slice(0, lastHyphen).trimEnd();
    }
  }
  return s;
}

function extractTitleYearFromStem(stemWithoutExt: string): {
  title: string | null;
  year: number | null;
} {
  let yearEnd: number | null = null;
  const ym = [...stemWithoutExt.matchAll(/\b((?:19|20)\d{2})\b/g)];
  if (ym.length > 0) {
    yearEnd = parseInt(ym[ym.length - 1]![1], 10);
  }

  const titlePort = stripSceneSuffixForTitle(stemWithoutExt);

  const pieces: string[] = [];
  for (const part of titlePort.split(/[.\s_-]+/).filter(Boolean)) {
    if (/^(?:19|20)\d{2}$/.test(part)) break;
    if (RES_HINT.test(part)) break;
    if (
      /^(?:x\d{3}|aac|ddp\d*|ddp|DVD|BR|HDR|HDR10\+?|DV|DOVI|WEB|Bluray)$/i.test(
        part,
      )
    )
      break;
    pieces.push(part);
  }

  let joined = pieces.join(" ").replace(/\s+/g, " ").trim();
  const seIdx = stemWithoutExt.search(/\bS\d{1,2}E\d{1,3}\b/i);
  if (joined.length < 2 && seIdx > 0) {
    const head = stemWithoutExt.slice(0, seIdx);
    joined = head
      .split(/[.\s_-]+/)
      .filter(Boolean)
      .slice(0, 8)
      .join(" ")
      .trim();
  }

  return {
    title: joined.length >= 2 ? joined : null,
    year: yearEnd,
  };
}

function buildParsed(fileNameWithExt: string): DownloadParsed {
  const stem = fileNameWithExt.replace(
    /\.(mkv|mp4|avi|m4v|wmv|ts|m2ts|mov)$/i,
    "",
  );
  const rel = parseReleaseTitle(stem);
  const seEp = parseReleaseSeasonEpisode(stem);

  const season = seEp?.season ?? null;
  const episodeNum = seEp?.episode ?? null;

  let kind: "movie" | "tv";
  let title: string | null;
  let year: number | null;

  if (season != null && episodeNum != null) {
    kind = "tv";
    const sr = stem.match(/^(.+?)[._-\s]+S\d{1,2}E\d{1,3}/i);
    const titleStem = sr?.[1] ?? stem;
    ({ title, year } = extractTitleYearFromStem(titleStem));
  } else {
    kind = "movie";
    ({ title, year } = extractTitleYearFromStem(stem));
  }

  const quality = rel.resolution != null ? `${rel.resolution}p` : null;
  const audio = rel.audio ? [rel.audio] : [];

  return {
    title,
    year,
    season,
    episode: episodeNum,
    quality,
    codec: rel.codec,
    release_group: rel.group,
    hdr: rel.hdr,
    audio,
    subtitles: [],
    kind,
  };
}

async function walkDownloadsOnce(
  roots: string[],
  excludeRoots: string[],
  inodeKeySet: Set<string>,
): Promise<RawDownloadRow[]> {
  const seenPaths = new Set<string>();
  const out: RawDownloadRow[] = [];

  for (const rootRaw of roots) {
    let videos: string[];
    try {
      videos = await listVideoFilesUnder(remapPath(resolve(rootRaw)));
    } catch {
      continue;
    }

    for (const relPathRaw of videos) {
      const filePath = resolve(relPathRaw);
      if (seenPaths.has(filePath)) continue;
      seenPaths.add(filePath);

      // Skip anything inside a configured library subtree — those are not
      // Downloads files, they're the library itself.
      if (excludeRoots.some((ex) => pathIsInsideRoot(filePath, ex))) continue;

      let st;
      try {
        st = await stat(remapPath(filePath));
      } catch {
        continue;
      }

      if (!st.isFile() || BigInt(st.size) < BigInt(MIN_BYTES)) continue;
      if (st.dev === undefined || st.ino === undefined) continue;

      const fileName = basename(filePath);
      const devNum = Number(st.dev);
      const inoNum = Number(st.ino);
      const keyStr = inodeKey(st.dev, st.ino);

      const parsed = buildParsed(fileName);

      out.push({
        file_path: filePath,
        file_name: fileName,
        size_bytes:
          typeof st.size === "bigint"
            ? Number(st.size)
            : Math.trunc(Number(st.size)),
        modified_at: st.mtime.toISOString(),
        dev: devNum,
        ino: inoNum,
        is_imported: inodeKeySet.has(keyStr),
        parsed,
      });
    }
  }

  out.sort((a, b) => b.size_bytes - a.size_bytes);
  return out;
}

/**
 * Recursive scan under both configured Downloads roots (`dirname(library_paths)`).
 * Cached 30s unless `refresh` bypasses cache.
 */
export async function scanDownloads(
  opts: {
    refresh?: boolean;
  } = {},
): Promise<ScanResult> {
  const now = Date.now();
  if (!opts.refresh && cache && cache.expiresAt > now) {
    return { entries: cache.entries, file_operation: cache.file_operation };
  }

  const settings = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  if (!settings)
    throw new Error("Media settings missing (expected singleton id = 1)");

  const fileOperation: "hardlink" | "move" =
    settings.fileOperation === "move" ? "move" : "hardlink";

  const roots = deriveDownloadsScanRoots(settings);
  if (roots.length === 0) {
    cache = {
      entries: [],
      file_operation: fileOperation,
      expiresAt: now + CACHE_MS,
    };
    return { entries: [], file_operation: fileOperation };
  }

  const excludeRoots = deriveLibraryExcludeRoots(settings);
  const inodeKeySet = await buildLibraryInodeKeySet(opts.refresh);
  const entries = await walkDownloadsOnce(roots, excludeRoots, inodeKeySet);
  cache = {
    entries,
    file_operation: fileOperation,
    expiresAt: now + CACHE_MS,
  };

  return { entries, file_operation: fileOperation };
}
