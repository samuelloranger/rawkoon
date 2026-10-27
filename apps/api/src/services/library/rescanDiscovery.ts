import { readdir, stat as statFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { prisma } from "@rawkoon/api/db";
import {
  scanMediaInfo,
  remapPath,
} from "@rawkoon/api/utils/medias/mediainfoScanner";
import {
  fingerprintDbFields,
  fingerprintFromStats,
  mapPool,
} from "@rawkoon/api/utils/medias/fileFingerprint";
import {
  parseFilenameMetadata,
  parseReleaseSeasonEpisode,
  parseReleaseTitle,
} from "@rawkoon/api/utils/medias/filenameParser";
import { isExcludedDir } from "@rawkoon/api/utils/medias/fileIdentifier";
import { classifyLanguageTags } from "@rawkoon/shared";
import type { LibraryAudioTrack } from "@rawkoon/shared";

const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".avi", ".m4v"]);
const SCAN_CONCURRENCY = 4;

type DiscoveryMedia = {
  type: string;
  title: string;
  year: number | null;
  status: string;
};

type DiscoverySettings = {
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
};

type DiscoveryCtx = {
  media: DiscoveryMedia;
  mediaSettings: DiscoverySettings | null;
  mediaId: number;
  trackedPaths: Set<string>;
};

function normalizeForDiscovery(str: string): string {
  // Fold accents first: "Ça" must become "ca", not " a" (which would then
  // match any filename containing the letter "a"). NFD leaves ligatures and
  // stroked letters whole, so those are spelled out by hand.
  return str
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Track untracked movie files in the library dir whose name matches the title and year. */
export async function discoverMovieFiles({
  media,
  mediaSettings,
  mediaId,
  trackedPaths,
}: DiscoveryCtx): Promise<number> {
  let imported = 0;
  const normalizedMovieTitle =
    media.type === "movie" && media.title
      ? normalizeForDiscovery(media.title)
      : "";
  // A title with no Latin letters or digits normalizes to "" and would match
  // every file, so it skips discovery.
  if (mediaSettings && normalizedMovieTitle) {
    const libraryPath = mediaSettings.moviesLibraryPath;
    if (libraryPath) {
      const remappedLibDir = remapPath(libraryPath);
      try {
        const entries = await readdir(remappedLibDir, { withFileTypes: true });
        const titleWords = ` ${normalizedMovieTitle} `;
        const yearWord = media.year != null ? ` ${media.year} ` : null;

        const candidates: Array<{
          diskPath: string;
          dbPath: string;
          name: string;
        }> = [];
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const ext = extname(entry.name);
          if (!VIDEO_EXTENSIONS.has(ext) || entry.name.startsWith("."))
            continue;

          const stem = entry.name.slice(0, -ext.length);
          const words = ` ${normalizeForDiscovery(stem)} `;
          if (!words.includes(titleWords)) continue;
          if (yearWord != null && !words.includes(yearWord)) continue;

          const diskPath = join(remappedLibDir, entry.name);
          const dbPath = join(libraryPath, entry.name);
          if (trackedPaths.has(dbPath)) continue;
          candidates.push({ diskPath, dbPath, name: entry.name });
        }

        // A file another library item already tracks belongs to that item.
        const ownedElsewhere =
          candidates.length > 0
            ? new Set(
                (
                  await prisma.mediaFile.findMany({
                    where: {
                      filePath: { in: candidates.map((c) => c.dbPath) },
                      mediaId: { not: mediaId },
                    },
                    select: { filePath: true },
                  })
                ).map((f) => f.filePath),
              )
            : new Set<string>();

        const created = await mapPool(
          candidates.filter((c) => !ownedElsewhere.has(c.dbPath)),
          SCAN_CONCURRENCY,
          async ({ diskPath, dbPath, name }) => {
            let st;
            try {
              st = await statFile(diskPath, { bigint: true });
            } catch {
              return false;
            }
            if (!st.isFile()) return false;
            const fp = fingerprintFromStats(st);
            const mi = await scanMediaInfo(diskPath);
            if (!mi) return false;

            const fnData = parseFilenameMetadata(name);
            await prisma.mediaFile.create({
              data: {
                mediaId,
                filePath: dbPath,
                fileName: name,
                ...fingerprintDbFields(fp),
                durationSecs: mi.durationSecs,
                releaseGroup: mi.releaseGroup,
                videoCodec: mi.videoCodec,
                videoProfile: mi.videoProfile,
                width: mi.width,
                height: mi.height,
                frameRate: mi.frameRate,
                bitDepth: mi.bitDepth,
                videoBitrate: mi.videoBitrate,
                hdrFormat: mi.hdrFormat ?? fnData.hdrFormat,
                resolution: mi.resolution ?? fnData.resolution,
                source: mi.source ?? fnData.source,
                audioTracks: mi.audioTracks as object[],
                subtitleTracks: mi.subtitleTracks as object[],
                languageTags: classifyLanguageTags(
                  mi.audioTracks as LibraryAudioTrack[],
                  null,
                ),
              },
            });
            trackedPaths.add(dbPath);
            return true;
          },
        );
        imported += created.filter(Boolean).length;
      } catch {
        // Library dir unreadable — skip discovery
      }

      if (imported > 0 && media.status === "wanted") {
        await prisma.libraryMedia.update({
          where: { id: mediaId },
          data: { status: "downloaded" },
        });
      }
    }
  }
  return imported;
}

/** Track untracked episode files under the show's folder, matched by SxxExx. */
export async function discoverShowEpisodes({
  media,
  mediaSettings,
  mediaId,
  trackedPaths,
  validEpisodeIds,
}: DiscoveryCtx & { validEpisodeIds: Set<number> }): Promise<number> {
  let imported = 0;
  if (mediaSettings && media.type === "show" && media.title) {
    const libraryPath = mediaSettings.showsLibraryPath;
    if (libraryPath) {
      const remappedLibDir = remapPath(libraryPath);
      const normalizedTitle = normalizeForDiscovery(media.title);
      // Match the show folder exactly (optionally with a trailing year), not by
      // substring: a short title like "From" must not admit "Tales From the
      // Crypt" and pull that show's SxxExx files into the wrong library item.
      const showDirNames = new Set([normalizedTitle]);
      if (media.year != null) {
        showDirNames.add(`${normalizedTitle} ${media.year}`);
      }
      const episodes = await prisma.libraryEpisode.findMany({
        where: { mediaId },
        select: { id: true, season: true, episode: true, status: true },
      });
      const epByKey = new Map(
        episodes.map((e) => [`${e.season}x${e.episode}`, e]),
      );

      try {
        const showDirs = await readdir(remappedLibDir, { withFileTypes: true });
        for (const showEntry of showDirs) {
          if (!showEntry.isDirectory()) continue;
          if (!showDirNames.has(normalizeForDiscovery(showEntry.name)))
            continue;

          const showDiskDir = join(remappedLibDir, showEntry.name);
          const showDbDir = join(libraryPath, showEntry.name);
          // Recurse one level (Season folders) plus files directly under the show.
          const seasonEntries = await readdir(showDiskDir, {
            withFileTypes: true,
          });
          const scanDirs: Array<{ disk: string; db: string }> = [
            { disk: showDiskDir, db: showDbDir },
          ];
          for (const se of seasonEntries) {
            // Skip sidecar dirs (Sample, Extras, …) so a tagged sample video
            // inside them can't be imported as the real episode.
            if (se.isDirectory() && !isExcludedDir(se.name))
              scanDirs.push({
                disk: join(showDiskDir, se.name),
                db: join(showDbDir, se.name),
              });
          }

          for (const dir of scanDirs) {
            const fileEntries = await readdir(dir.disk, {
              withFileTypes: true,
            }).catch(() => []);
            const candidates: Array<{
              diskPath: string;
              dbPath: string;
              name: string;
              epId: number;
            }> = [];
            for (const entry of fileEntries) {
              if (!entry.isFile()) continue;
              const ext = extname(entry.name).toLowerCase();
              if (!VIDEO_EXTENSIONS.has(ext) || entry.name.startsWith("."))
                continue;

              const dbPath = join(dir.db, entry.name);
              if (trackedPaths.has(dbPath)) continue;

              if (parseReleaseTitle(entry.name).isSample) continue;
              const se = parseReleaseSeasonEpisode(entry.name);
              if (!se || se.episode == null) continue;
              const ep = epByKey.get(`${se.season}x${se.episode}`);
              if (!ep) continue;

              candidates.push({
                diskPath: join(dir.disk, entry.name),
                dbPath,
                name: entry.name,
                epId: ep.id,
              });
            }

            const created = await mapPool(
              candidates,
              SCAN_CONCURRENCY,
              async ({ diskPath, dbPath, name, epId }) => {
                let st;
                try {
                  st = await statFile(diskPath, { bigint: true });
                } catch {
                  return false;
                }
                if (!st.isFile()) return false;
                const fp = fingerprintFromStats(st);
                const mi = await scanMediaInfo(diskPath);
                if (!mi) return false;

                const fnData = parseFilenameMetadata(name);
                await prisma.mediaFile.create({
                  data: {
                    mediaId,
                    episodeId: epId,
                    filePath: dbPath,
                    fileName: name,
                    ...fingerprintDbFields(fp),
                    durationSecs: mi.durationSecs,
                    releaseGroup: mi.releaseGroup,
                    videoCodec: mi.videoCodec,
                    videoProfile: mi.videoProfile,
                    width: mi.width,
                    height: mi.height,
                    frameRate: mi.frameRate,
                    bitDepth: mi.bitDepth,
                    videoBitrate: mi.videoBitrate,
                    hdrFormat: mi.hdrFormat ?? fnData.hdrFormat,
                    resolution: mi.resolution ?? fnData.resolution,
                    source: mi.source ?? fnData.source,
                    audioTracks: mi.audioTracks as object[],
                    subtitleTracks: mi.subtitleTracks as object[],
                    languageTags: classifyLanguageTags(
                      mi.audioTracks as LibraryAudioTrack[],
                      null,
                    ),
                  },
                });
                await prisma.libraryEpisode.update({
                  where: { id: epId },
                  data: { status: "downloaded", downloadedAt: new Date() },
                });
                validEpisodeIds.add(epId);
                // Intentionally do NOT set hasValidFile: it gates the requeue of
                // null-episode (season-pack / full-series) download histories.
                // Importing one orphaned episode must not suppress reprocessing a
                // still-present pack that could recover the remaining episodes;
                // per-episode histories are covered by validEpisodeIds above.
                trackedPaths.add(dbPath);
                return true;
              },
            );
            imported += created.filter(Boolean).length;
          }
        }
      } catch {
        // Library dir unreadable — skip discovery
      }
    }
  }
  return imported;
}
