import { basename, extname, isAbsolute, join } from "node:path";
import { stat, unlink } from "node:fs/promises";

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
import { findVideoFile } from "@rawkoon/api/utils/medias/fileIdentifier";
import {
  renderEpisodeTemplate,
  renderMovieTemplate,
  sanitizeFilenamePart,
  sanitizePathTemplateOutput,
} from "@rawkoon/api/utils/medias/fileTemplate";
import { getQbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/config";
import {
  fetchQbittorrentTorrent,
  fetchQbittorrentTorrentProperties,
} from "@rawkoon/api/services/qbittorrent/torrentQueries";
import { deleteQbittorrentTorrent } from "@rawkoon/api/services/qbittorrent/torrentMutations";
import {
  markItemDownloaded,
  placeFile,
  qualityStringsFromParsed,
  resolveTorrentContentPath,
} from "@rawkoon/api/services/postProcessorHelpers";
import { postProcessSeasonPack } from "@rawkoon/api/services/postProcessorSeasonPack";

/**
 * After a library torrent completes: hardlink/move into the configured library tree.
 */
export async function postProcess(
  downloadHistoryId: number,
): Promise<
  | { success: true; destinationPath: string }
  | { success: false; reason: string }
> {
  const [dh, settings] = await Promise.all([
    prisma.downloadHistory.findUnique({
      where: { id: downloadHistoryId },
      include: { media: true, episode: true },
    }),
    prisma.mediaSettings.findUnique({ where: { id: 1 } }),
  ]);
  if (!dh || !dh.media) {
    return { success: false, reason: "Download history or media not found" };
  }
  if (dh.failed || !dh.completedAt) {
    return { success: false, reason: "Download not completed" };
  }
  if (!settings?.postProcessingEnabled) {
    return { success: false, reason: "Post-processing disabled" };
  }

  const op = settings.fileOperation === "move" ? "move" : "hardlink";

  if (dh.media.type === "movie") {
    if (!settings.moviesLibraryPath?.trim()) {
      return { success: false, reason: "Movies library path not configured" };
    }
  } else if (dh.media.type === "show") {
    if (!settings.showsLibraryPath?.trim()) {
      return { success: false, reason: "Shows library path not configured" };
    }
    // Season pack / intégrale — no episodeId — process all files in the folder
    if (!dh.episode) {
      const qb = await getQbittorrentIntegrationConfig();
      if (!qb.enabled || !qb.config) {
        return { success: false, reason: "qBittorrent not configured" };
      }
      return postProcessSeasonPack(
        downloadHistoryId,
        {
          id: dh.id,
          media: dh.media!,
          episode: null,
          torrentHash: dh.torrentHash,
          releaseTitle: dh.releaseTitle,
          qualityParsed: dh.qualityParsed,
        },
        settings,
        op,
        qb,
      );
    }
  } else {
    return { success: false, reason: "Unknown media type" };
  }

  // ── Pre-scan: check if a MediaFile already exists on disk for this item ──────
  // This handles cases where files were placed manually or by a previous run.
  // If found, register the file and mark as downloaded without touching qBittorrent.
  // Skipped for upgrade grabs — the old file is still present and should not short-circuit.
  if (!dh.isUpgrade) {
    const existingFiles = await prisma.mediaFile.findMany({
      where: dh.episode
        ? { episodeId: dh.episode.id }
        : { mediaId: dh.media.id, episodeId: null },
      select: { id: true, filePath: true },
    });
    for (const ef of existingFiles) {
      try {
        await stat(ef.filePath);
        // File is on disk — mark complete and return without hardlinking
        await markItemDownloaded({ media: dh.media!, episode: dh.episode });
        await prisma.downloadHistory.update({
          where: { id: downloadHistoryId },
          data: {
            postProcessDestinationPath: ef.filePath,
            postProcessError: null,
          },
        });
        return { success: true, destinationPath: ef.filePath };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(
            `[postProcess] stat existing file unexpected error (${ef.filePath}):`,
            e,
          );
        }
        // File gone from disk — continue to normal flow
      }
    }
  }

  const hash = dh.torrentHash?.trim();
  if (!hash) {
    return { success: false, reason: "Torrent hash unknown" };
  }

  const qb = await getQbittorrentIntegrationConfig();
  if (!qb.enabled || !qb.config) {
    return { success: false, reason: "qBittorrent not configured" };
  }

  const tRes = await fetchQbittorrentTorrent(qb.config, qb.enabled, hash);
  if (!tRes.torrent) {
    return {
      success: false,
      reason: tRes.error ?? "Torrent not found in qBittorrent",
    };
  }

  const tor = tRes.torrent;
  const cpTrim = tor.content_path?.trim() ?? "";
  let savePathForJoin: string | null = null;
  if (!cpTrim || !isAbsolute(cpTrim)) {
    const pRes = await fetchQbittorrentTorrentProperties(
      qb.config,
      qb.enabled,
      hash,
    );
    savePathForJoin = pRes.properties?.save_path ?? null;
  }

  const contentBase = resolveTorrentContentPath(
    tor.content_path,
    savePathForJoin,
    tor.name,
  );
  if (!contentBase) {
    return { success: false, reason: "Could not resolve torrent content path" };
  }

  const srcVideo = await findVideoFile(remapPath(contentBase));
  if (!srcVideo) {
    return { success: false, reason: "No video file found" };
  }

  const ext = extname(srcVideo) || ".mkv";
  const q = qualityStringsFromParsed(dh.qualityParsed, dh.releaseTitle);

  const root =
    dh.media.type === "movie"
      ? settings.moviesLibraryPath!.replace(/\/+$/, "")
      : settings.showsLibraryPath!.replace(/\/+$/, "");

  let relativeDest: string;
  if (dh.media.type === "movie") {
    const stem =
      renderMovieTemplate(settings.movieTemplate, {
        title: dh.media.title,
        year: dh.media.year,
        resolution: q.resolution,
        source: q.source,
        codec: q.codec,
        ext,
      }) || sanitizeFilenamePart(dh.media.title);
    relativeDest = `${stem}${ext}`;
  } else {
    const ep = dh.episode!;
    const epStem =
      renderEpisodeTemplate(settings.episodeTemplate, {
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
    relativeDest = `${epStem}${ext}`;
  }

  const destinationPath = join(root, relativeDest);

  try {
    await placeFile(srcVideo, destinationPath, op);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, reason: msg };
  }

  // Create (or refresh) a MediaFile record so the library listing reflects the processed file.
  try {
    const destFileName = basename(destinationPath);
    const fnData = parseFilenameMetadata(destFileName);
    const mi = await scanMediaInfo(destinationPath);

    const existingFile = await prisma.mediaFile.findFirst({
      where: { filePath: destinationPath },
      select: { id: true },
    });

    const rtParsed = parseReleaseTitle(dh.releaseTitle);
    const fileData = mi
      ? {
          mediaId: dh.media!.id,
          episodeId: dh.episode?.id ?? null,
          filePath: destinationPath,
          fileName: destFileName,
          sizeBytes: mi.sizeBytes,
          durationSecs: mi.durationSecs,
          releaseGroup:
            mi.releaseGroup ?? parseReleaseGroupFromTitle(dh.releaseTitle),
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
          audioFormat: rtParsed.audio,
          isProper: rtParsed.isProper,
          audioTracks: mi.audioTracks as object[],
          subtitleTracks: mi.subtitleTracks as object[],
          languageTags: classifyLanguageTags(
            mi.audioTracks as LibraryAudioTrack[],
            dh.releaseTitle,
          ),
        }
      : {
          mediaId: dh.media!.id,
          episodeId: dh.episode?.id ?? null,
          filePath: destinationPath,
          fileName: destFileName,
          sizeBytes: BigInt(0),
          releaseGroup: parseReleaseGroupFromTitle(dh.releaseTitle),
          resolution: fnData.resolution,
          source: fnData.source ?? q.source,
          hdrFormat: fnData.hdrFormat,
          audioFormat: rtParsed.audio,
          isProper: rtParsed.isProper,
          audioTracks: [] as object[],
          subtitleTracks: [] as object[],
          languageTags: [] as string[],
        };

    let newMediaFileId: number | null = null;
    if (existingFile) {
      await prisma.mediaFile.update({
        where: { id: existingFile.id },
        data: fileData,
      });
      newMediaFileId = existingFile.id;
    } else {
      const created = await prisma.mediaFile.create({ data: fileData });
      newMediaFileId = created.id;
    }

    // Delete old files after a successful upgrade placement.
    if (dh.isUpgrade && newMediaFileId != null) {
      const oldFiles = await prisma.mediaFile.findMany({
        where:
          dh.episode != null
            ? { episodeId: dh.episode.id, id: { not: newMediaFileId } }
            : {
                mediaId: dh.media!.id,
                episodeId: null,
                id: { not: newMediaFileId },
              },
        select: { id: true, filePath: true },
      });

      const idsToDelete: number[] = [];
      await Promise.all(
        oldFiles.map(async (oldFile) => {
          try {
            await unlink(oldFile.filePath);
            idsToDelete.push(oldFile.id);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
              idsToDelete.push(oldFile.id); // file already gone, clean up DB row
            } else {
              console.warn(
                `[postProcess/upgrade] Failed to delete old file ${oldFile.filePath}:`,
                e,
              );
            }
          }
        }),
      );
      if (idsToDelete.length > 0) {
        await prisma.mediaFile.deleteMany({
          where: { id: { in: idsToDelete } },
        });
      }

      if (oldFiles.length > 0) {
        console.log(
          `[postProcess/upgrade] Deleted ${oldFiles.length} old file(s) for media=${dh.media!.id}`,
        );
      }
    }
  } catch (e) {
    // Non-fatal: file is on disk, the record can be recovered via manual rescan.
    console.warn("[postProcess] MediaFile upsert failed:", e);
  }

  // Mark the library item as downloaded now that the file is on disk.
  try {
    await markItemDownloaded({ media: dh.media!, episode: dh.episode });
  } catch (e) {
    console.warn("[postProcess] Status update to downloaded failed:", e);
  }

  const ratio = tor.ratio;
  const min = settings.minSeedRatio;
  const shouldRemove = min <= 0 || (ratio != null && ratio >= min);
  if (shouldRemove) {
    const del = await deleteQbittorrentTorrent(qb.config, qb.enabled, {
      hash,
      delete_files: false,
    });
    if (!del.success) {
      console.warn(
        `[postProcess] Could not remove torrent ${hash}:`,
        del.error,
      );
    }
  }

  return { success: true, destinationPath };
}
