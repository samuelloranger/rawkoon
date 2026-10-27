import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";
import { parseFilenameMetadata } from "@rawkoon/api/utils/medias/filenameParser";
import { resolveDownloadedStatus } from "@rawkoon/api/utils/medias/libraryHelpers";
import {
  fingerprintDbFields,
  fingerprintFromStats,
} from "@rawkoon/api/utils/medias/fileFingerprint";
import {
  remapPath,
  scanMediaInfo,
} from "@rawkoon/api/utils/medias/mediainfoScanner";

export async function persistMediaAndStatuses(opts: {
  destinationPathHost: string;
  mediaId: number;
  episodeId: number | null;
  releaseStemForLanguages: string;
  libraryRow: {
    id: number;
    type: string;
    tmdbStatus: string | null;
  };
}) {
  const destMapped = remapPath(opts.destinationPathHost);
  const destBase = basename(opts.destinationPathHost);
  const fnData = parseFilenameMetadata(destBase);
  const destStat = await stat(destMapped, { bigint: true });
  const fp = fingerprintFromStats(destStat);
  const mi = await scanMediaInfo(destMapped).catch(() => null);

  const fileDataMi = mi
    ? {
        mediaId: opts.mediaId,
        episodeId: opts.episodeId,
        filePath: opts.destinationPathHost,
        fileName: destBase,
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
          opts.releaseStemForLanguages,
        ),
        scannedAt: new Date(),
      }
    : {
        mediaId: opts.mediaId,
        episodeId: opts.episodeId,
        filePath: opts.destinationPathHost,
        fileName: destBase,
        ...fingerprintDbFields(fp),
        durationSecs: null as number | null,
        releaseGroup: null as string | null,
        resolution: fnData.resolution,
        source: fnData.source ?? null,
        hdrFormat: fnData.hdrFormat,
        audioTracks: [] as object[],
        subtitleTracks: [] as object[],
        languageTags: [] as string[],
        videoCodec: null as string | null,
        videoProfile: null as string | null,
        width: null as number | null,
        height: null as number | null,
        frameRate: null as number | null,
        bitDepth: null as number | null,
        videoBitrate: null as number | null,
      };

  const existing = await prisma.mediaFile.findFirst({
    where: { filePath: opts.destinationPathHost },
    select: { id: true },
  });

  let mfRow: { id: number };
  if (existing) {
    mfRow = await prisma.mediaFile.update({
      where: { id: existing.id },
      data: fileDataMi,
      select: { id: true },
    });
  } else {
    mfRow = await prisma.mediaFile.create({
      data: fileDataMi,
      select: { id: true },
    });
  }

  if (opts.episodeId != null) {
    await prisma.libraryEpisode.update({
      where: { id: opts.episodeId },
      data: { status: "downloaded", downloadedAt: new Date() },
    });
  }

  await prisma.libraryMedia.update({
    where: { id: opts.mediaId },
    data: {
      status: resolveDownloadedStatus(
        opts.libraryRow.type,
        opts.libraryRow.tmdbStatus,
      ),
    },
  });

  return mfRow;
}
