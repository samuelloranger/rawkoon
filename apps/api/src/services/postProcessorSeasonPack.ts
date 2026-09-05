import { basename, extname, join } from "node:path";
import { stat, rm } from "node:fs/promises";

import { prisma } from "@rawkoon/api/db";
import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";
import {
  parseFilenameMetadata,
  parseReleaseGroupFromTitle,
  parseReleaseTitle,
} from "@rawkoon/api/utils/medias/filenameParser";
import {
  scanMediaInfo,
  remapPath,
} from "@rawkoon/api/utils/medias/mediainfoScanner";
import {
  fingerprintDbFields,
  fingerprintFromStats,
} from "@rawkoon/api/utils/medias/fileFingerprint";
import { listVideoFilesUnder } from "@rawkoon/api/utils/medias/fileIdentifier";
import {
  renderEpisodeTemplate,
  sanitizePathTemplateOutput,
} from "@rawkoon/api/utils/medias/fileTemplate";
import type { DownloadClientAdapter } from "@rawkoon/api/services/downloadClient/types";
import { resolveDownloadedStatus } from "@rawkoon/api/utils/medias/libraryHelpers";

import {
  parseSeasonEpisode,
  placeFile,
  qualityStringsFromParsed,
  resolveTorrentContentPath,
} from "@rawkoon/api/services/postProcessorHelpers";
import {
  parsePartMarker,
  resolveSeasonPackMapping,
} from "@rawkoon/api/services/library/seasonPackMapping";
import {
  mkvAppend,
  tracksCompatible,
} from "@rawkoon/api/utils/medias/mkvMerge";

/**
 * Post-process a season pack / intégrale: find all video files under the torrent
 * folder, match each to a LibraryEpisode by SxxExx, hardlink/move to library.
 */
export async function postProcessSeasonPack(
  downloadHistoryId: number,
  dh: {
    id: number;
    media: {
      id: number;
      type: string;
      title: string;
      year: number | null;
      tmdbStatus: string | null;
    };
    episode: null;
    torrentHash: string | null;
    releaseTitle: string;
    qualityParsed: unknown;
  },
  settings: {
    showsLibraryPath: string | null;
    episodeTemplate: string | null;
    fileOperation: string | null;
    minSeedRatio: number;
  },
  op: "hardlink" | "move",
  adapter: DownloadClientAdapter,
): Promise<
  | { success: true; destinationPath: string; episodeCount: number }
  | { success: false; reason: string }
> {
  const hash = dh.torrentHash?.trim();
  if (!hash) return { success: false, reason: "Torrent hash unknown" };
  const tor = await adapter.getTorrent(hash);
  if (!tor)
    return { success: false, reason: "Torrent not found in download client" };

  const contentBase = resolveTorrentContentPath(
    tor.contentPath,
    tor.savePath,
    tor.name,
  );
  if (!contentBase)
    return { success: false, reason: "Could not resolve torrent content path" };

  const allVideos = await listVideoFilesUnder(remapPath(contentBase));
  if (allVideos.length === 0)
    return { success: false, reason: "No video files found in torrent folder" };

  const episodes = await prisma.libraryEpisode.findMany({
    where: { mediaId: dh.media.id },
  });

  const root = settings.showsLibraryPath!.replace(/\/+$/, "");
  const q = qualityStringsFromParsed(dh.qualityParsed, dh.releaseTitle);

  // Dedupe source files that resolve to the same episode before mapping them.
  // Multiple sources for one episode share a destinationPath, so processing
  // them concurrently would race the findFirst-then-create below and produce
  // duplicate MediaFile rows. Keep the first source per episode.
  const seenEpisodeKeys = new Set<string>();
  const parsedSources = allVideos.flatMap((srcVideo) => {
    const fileName = basename(srcVideo);
    const se = parseSeasonEpisode(fileName);
    if (!se) {
      console.warn(
        `[postProcess/pack] Could not parse SxxExx from "${fileName}", skipping`,
      );
      return [];
    }
    const key = `${se.season}x${se.episode}`;
    if (seenEpisodeKeys.has(key)) return [];
    seenEpisodeKeys.add(key);
    return [
      {
        path: srcVideo,
        fileName,
        season: se.season,
        episode: se.episode,
        part: parsePartMarker(fileName),
        ext: extname(srcVideo) || ".mkv",
      },
    ];
  });

  const mapping = resolveSeasonPackMapping(parsedSources, episodes);

  /**
   * Abandon the whole pack: record why, blocklist the release, import nothing.
   *
   * Without the blocklist the episodes stay "wanted", auto-search finds the
   * same highest-scoring pack, grabs it, refuses it again, and loops forever.
   */
  const refusePack = async (reason: string) => {
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: { postProcessError: reason },
    });
    await prisma.grabBlocklist.create({
      data: {
        torrentHash: hash,
        releaseTitle: dh.releaseTitle,
        mediaId: dh.media.id,
        reason,
      },
    });
    console.warn(`[postProcess/pack] ${dh.media.title}: ${reason}`);
    return { success: false as const, reason };
  };

  if (!mapping.ok) {
    // Import nothing. A partially-correct season is worse than none: the files
    // that "work" get renamed to the wrong episode's title and look fine until
    // someone watches them.
    return refusePack(
      `Season pack numbering does not match the provider — nothing imported. ${
        mapping.reason
      }${
        mapping.unmatched.length > 0
          ? ` Unmatched: ${mapping.unmatched.join(", ")}`
          : ""
      }`,
    );
  }

  // Preflight every merge candidate BEFORE placing anything. Checking track
  // compatibility inside the placement loop would surface the failure after
  // sibling episodes are already hardlinked, and since `processed > 0` the
  // run would then clear postProcessError, mark the show downloaded, and
  // possibly remove the torrent — the opposite of all-or-nothing.
  for (const placement of mapping.placements) {
    if (placement.kind !== "merge") continue;
    const [a, b] = placement.sources;
    const [miA, miB] = await Promise.all([
      scanMediaInfo(a.path),
      scanMediaInfo(b.path),
    ]);
    if (!miA || !miB) {
      return refusePack(
        `Season pack contains a split episode that MediaInfo cannot read — nothing imported. Could not scan "${miA ? b.fileName : a.fileName}".`,
      );
    }
    if (!tracksCompatible(miA, miB)) {
      return refusePack(
        `Season pack contains a split episode whose parts are not mergeable — nothing imported. "${a.fileName}" and "${b.fileName}" have different track layouts.`,
      );
    }
  }

  type EpisodeResult =
    | { ok: true; destinationPath: string }
    | { ok: false; error: string; fatal?: boolean };

  const PACK_CONCURRENCY = 6;
  const episodeResults: (EpisodeResult | null)[] = [];
  for (let i = 0; i < mapping.placements.length; i += PACK_CONCURRENCY) {
    const chunk = mapping.placements.slice(i, i + PACK_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (placement): Promise<EpisodeResult | null> => {
        const ep = placement.episode;
        const primary = placement.sources[0];
        const srcVideo = primary.path;
        const fn = primary.fileName;
        const ext = primary.ext;
        const epStem =
          renderEpisodeTemplate(settings.episodeTemplate ?? "", {
            show: dh.media.title,
            season: ep.season,
            episode: ep.episode,
            title: ep.title,
            resolution: q.resolution,
            source: q.source,
            ext,
          }) ||
          sanitizePathTemplateOutput(
            `${dh.media.title}/Season ${ep.season}/${dh.media.title} - S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`,
          );
        const destinationPath = join(root, `${epStem}${ext}`);

        if (placement.kind === "merge") {
          // Track compatibility was already verified in the preflight above.
          const [a, b] = placement.sources;
          if (!(await mkvAppend([a.path, b.path], destinationPath))) {
            // Fatal: a season missing its double episode must not be reported
            // as a successful import.
            return {
              ok: false,
              fatal: true,
              error: `S${ep.season}E${ep.episode}: merging "${a.fileName}" + "${b.fileName}" failed`,
            };
          }
          // The merged file is new content, never a hardlink to the source
          // parts. In move mode the parts are consumed; in hardlink mode they
          // stay put so the torrent keeps seeding.
          if (op === "move") {
            await Promise.all(
              [a.path, b.path].map((p) =>
                rm(p).catch((e) =>
                  console.warn(
                    `[postProcess/pack] Could not remove part ${p}:`,
                    e,
                  ),
                ),
              ),
            );
          }
        } else {
          try {
            await placeFile(srcVideo, destinationPath, op);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, error: `S${ep.season}E${ep.episode}: ${msg}` };
          }
        }
        try {
          const fnData = parseFilenameMetadata(fn);
          const destMapped = remapPath(destinationPath);
          const destStat = await stat(destMapped, { bigint: true });
          const fp = fingerprintFromStats(destStat);
          const mi = await scanMediaInfo(destinationPath);
          const existingFile = await prisma.mediaFile.findFirst({
            where: { filePath: destinationPath },
            select: { id: true },
          });
          const rtParsedPack = parseReleaseTitle(dh.releaseTitle);
          const fileData = mi
            ? {
                mediaId: dh.media.id,
                episodeId: ep.id,
                filePath: destinationPath,
                fileName: basename(destinationPath),
                ...fingerprintDbFields(fp),
                durationSecs: mi.durationSecs,
                releaseGroup:
                  mi.releaseGroup ??
                  parseReleaseGroupFromTitle(dh.releaseTitle),
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
                audioFormat: rtParsedPack.audio,
                isProper: rtParsedPack.isProper,
                audioTracks: mi.audioTracks as object[],
                subtitleTracks: mi.subtitleTracks as object[],
                languageTags: classifyLanguageTags(
                  mi.audioTracks as LibraryAudioTrack[],
                  dh.releaseTitle,
                ),
                scannedAt: new Date(),
              }
            : {
                mediaId: dh.media.id,
                episodeId: ep.id,
                filePath: destinationPath,
                fileName: basename(destinationPath),
                ...fingerprintDbFields(fp),
                releaseGroup: parseReleaseGroupFromTitle(dh.releaseTitle),
                resolution: fnData.resolution,
                source: fnData.source ?? q.source,
                hdrFormat: fnData.hdrFormat,
                audioFormat: rtParsedPack.audio,
                isProper: rtParsedPack.isProper,
                audioTracks: [] as object[],
                subtitleTracks: [] as object[],
                languageTags: [] as string[],
              };
          if (existingFile) {
            await prisma.mediaFile.update({
              where: { id: existingFile.id },
              data: fileData,
            });
          } else {
            await prisma.mediaFile.create({ data: fileData });
          }
        } catch (e) {
          console.warn(
            `[postProcess/pack] MediaFile upsert failed for ${fn}:`,
            e,
          );
        }
        try {
          await prisma.libraryEpisode.update({
            where: { id: ep.id },
            data: { status: "downloaded", downloadedAt: new Date() },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            ok: false,
            error: `S${ep.season}E${ep.episode}: episode status update failed: ${msg}`,
          };
        }
        return { ok: true, destinationPath };
      }),
    );
    episodeResults.push(...chunkResults);
  }

  let processed = 0;
  const errors: string[] = [];
  const fatalErrors: string[] = [];
  let firstDest: string | null = null;
  for (const result of episodeResults) {
    if (result === null) continue;
    if (!result.ok) {
      errors.push(result.error);
      if (result.fatal) fatalErrors.push(result.error);
    } else {
      processed++;
      if (!firstDest) firstDest = result.destinationPath;
    }
  }

  // A failed merge leaves the season without its double episode. Reporting
  // that as a success would clear postProcessError, mark the show downloaded,
  // and let the torrent be removed — losing the only copy of the parts.
  if (fatalErrors.length > 0) {
    return refusePack(
      `Season pack partially imported but a split episode could not be merged — ${fatalErrors.join("; ")}`,
    );
  }

  if (processed === 0) {
    return {
      success: false,
      reason:
        errors.length > 0
          ? errors.join("; ")
          : "No episodes could be matched or placed",
    };
  }

  await prisma.libraryMedia.update({
    where: { id: dh.media.id },
    data: {
      status: resolveDownloadedStatus(dh.media.type, dh.media.tmdbStatus),
    },
  });
  await prisma.downloadHistory.update({
    where: { id: downloadHistoryId },
    data: { postProcessDestinationPath: firstDest, postProcessError: null },
  });

  console.log(
    `[postProcess/pack] Processed ${processed} episodes for "${dh.media.title}" (${errors.length} errors)`,
  );

  // Remove torrent if seed ratio met
  const ratio = tor.ratio;
  const min = settings.minSeedRatio;
  const shouldRemove = min <= 0 || (ratio != null && ratio >= min);
  if (shouldRemove) {
    await adapter
      .remove(hash, false)
      .catch((error) =>
        console.warn(
          `[postProcess/pack] Could not remove torrent ${hash}:`,
          error,
        ),
      );
  }

  return {
    success: true,
    destinationPath: firstDest!,
    episodeCount: processed,
  };
}
