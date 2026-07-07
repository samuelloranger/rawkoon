import { basename, extname, isAbsolute, join } from "node:path";

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
import { listVideoFilesUnder } from "@rawkoon/api/utils/medias/fileIdentifier";
import {
  renderEpisodeTemplate,
  sanitizePathTemplateOutput,
} from "@rawkoon/api/utils/medias/fileTemplate";
import { getQbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/config";
import {
  fetchQbittorrentTorrent,
  fetchQbittorrentTorrentProperties,
} from "@rawkoon/api/services/qbittorrent/torrentQueries";
import { deleteQbittorrentTorrent } from "@rawkoon/api/services/qbittorrent/torrentMutations";
import { resolveDownloadedStatus } from "@rawkoon/api/utils/medias/libraryHelpers";

import {
  parseSeasonEpisode,
  placeFile,
  qualityStringsFromParsed,
  resolveTorrentContentPath,
} from "@rawkoon/api/services/postProcessorHelpers";

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
  qb: Awaited<ReturnType<typeof getQbittorrentIntegrationConfig>>,
): Promise<
  | { success: true; destinationPath: string }
  | { success: false; reason: string }
> {
  const hash = dh.torrentHash?.trim();
  if (!hash) return { success: false, reason: "Torrent hash unknown" };
  const qbConfig = qb.config!;

  const tRes = await fetchQbittorrentTorrent(qbConfig, qb.enabled, hash);
  if (!tRes.torrent)
    return {
      success: false,
      reason: tRes.error ?? "Torrent not found in qBittorrent",
    };

  const tor = tRes.torrent;
  let savePathForJoin: string | null = null;
  const cpTrim = tor.content_path?.trim() ?? "";
  if (!cpTrim || !isAbsolute(cpTrim)) {
    const pRes = await fetchQbittorrentTorrentProperties(
      qbConfig,
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
  if (!contentBase)
    return { success: false, reason: "Could not resolve torrent content path" };

  const allVideos = await listVideoFilesUnder(remapPath(contentBase));
  if (allVideos.length === 0)
    return { success: false, reason: "No video files found in torrent folder" };

  // Load all episodes for this show
  const episodes = await prisma.libraryEpisode.findMany({
    where: { mediaId: dh.media.id },
  });
  const epMap = new Map(episodes.map((e) => [`${e.season}x${e.episode}`, e]));

  const root = settings.showsLibraryPath!.replace(/\/+$/, "");
  const q = qualityStringsFromParsed(dh.qualityParsed, dh.releaseTitle);

  // Dedupe source files that resolve to the same episode before placing them.
  // Multiple sources for one episode share a destinationPath, so processing
  // them concurrently would race the findFirst-then-create below and produce
  // duplicate MediaFile rows. Keep the first source per episode; unparsable
  // files still flow through (they warn + skip inside the worker).
  const seenEpisodeKeys = new Set<string>();
  const dedupedVideos = allVideos.filter((srcVideo) => {
    const se = parseSeasonEpisode(basename(srcVideo));
    if (!se) return true;
    const key = `${se.season}x${se.episode}`;
    if (seenEpisodeKeys.has(key)) return false;
    seenEpisodeKeys.add(key);
    return true;
  });

  type EpisodeResult =
    | { ok: true; destinationPath: string }
    | { ok: false; error: string };

  const PACK_CONCURRENCY = 6;
  const episodeResults: (EpisodeResult | null)[] = [];
  for (let i = 0; i < dedupedVideos.length; i += PACK_CONCURRENCY) {
    const chunk = dedupedVideos.slice(i, i + PACK_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (srcVideo): Promise<EpisodeResult | null> => {
        const fn = basename(srcVideo);
        const se = parseSeasonEpisode(fn);
        if (!se) {
          console.warn(
            `[postProcess/pack] Could not parse SxxExx from "${fn}", skipping`,
          );
          return null;
        }
        const ep = epMap.get(`${se.season}x${se.episode}`);
        if (!ep) {
          console.warn(
            `[postProcess/pack] No LibraryEpisode for S${se.season}E${se.episode} of "${dh.media.title}", skipping`,
          );
          return null;
        }
        const ext = extname(srcVideo) || ".mkv";
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
        try {
          await placeFile(srcVideo, destinationPath, op);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: `S${se.season}E${se.episode}: ${msg}` };
        }
        try {
          const fnData = parseFilenameMetadata(fn);
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
                sizeBytes: mi.sizeBytes,
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
              }
            : {
                mediaId: dh.media.id,
                episodeId: ep.id,
                filePath: destinationPath,
                fileName: basename(destinationPath),
                sizeBytes: BigInt(0),
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
            error: `S${se.season}E${se.episode}: episode status update failed: ${msg}`,
          };
        }
        return { ok: true, destinationPath };
      }),
    );
    episodeResults.push(...chunkResults);
  }

  let processed = 0;
  const errors: string[] = [];
  let firstDest: string | null = null;
  for (const result of episodeResults) {
    if (result === null) continue;
    if (!result.ok) {
      errors.push(result.error);
    } else {
      processed++;
      if (!firstDest) firstDest = result.destinationPath;
    }
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

  // Mark the show as downloaded and update the DH record
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
    const del = await deleteQbittorrentTorrent(qbConfig, qb.enabled, {
      hash,
      delete_files: false,
    });
    if (!del.success)
      console.warn(
        `[postProcess/pack] Could not remove torrent ${hash}:`,
        del.error,
      );
  }

  return { success: true, destinationPath: firstDest! };
}
