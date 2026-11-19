import { basename } from "node:path";
import { stat } from "node:fs/promises";

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
import { tracksCompatible } from "@rawkoon/api/utils/medias/mkvMerge";

/** Create or refresh the MediaFile row for one placed pack episode. */
export async function upsertPackMediaFile(opts: {
  mediaId: number;
  episodeId: number;
  destinationPath: string;
  fileName: string;
  releaseTitle: string;
  fallbackSource: string | null;
}): Promise<void> {
  const fnData = parseFilenameMetadata(opts.fileName);
  const destMapped = remapPath(opts.destinationPath);
  const destStat = await stat(destMapped, { bigint: true });
  const fp = fingerprintFromStats(destStat);
  const mi = await scanMediaInfo(opts.destinationPath);
  const existingFile = await prisma.mediaFile.findFirst({
    where: { filePath: opts.destinationPath },
    select: { id: true },
  });
  const rtParsedPack = parseReleaseTitle(opts.releaseTitle);
  const fileData = mi
    ? {
        mediaId: opts.mediaId,
        episodeId: opts.episodeId,
        filePath: opts.destinationPath,
        fileName: basename(opts.destinationPath),
        ...fingerprintDbFields(fp),
        durationSecs: mi.durationSecs,
        releaseGroup:
          mi.releaseGroup ?? parseReleaseGroupFromTitle(opts.releaseTitle),
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
          opts.releaseTitle,
        ),
        scannedAt: new Date(),
      }
    : {
        mediaId: opts.mediaId,
        episodeId: opts.episodeId,
        filePath: opts.destinationPath,
        fileName: basename(opts.destinationPath),
        ...fingerprintDbFields(fp),
        releaseGroup: parseReleaseGroupFromTitle(opts.releaseTitle),
        resolution: fnData.resolution,
        source: fnData.source ?? opts.fallbackSource,
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
}

type MergePlacement = {
  kind: string;
  sources: { path: string; fileName: string }[];
};

/**
 * Checks every merge candidate before anything is placed, so an unmergeable
 * split episode fails the pack all-or-nothing. Returns the refusal reason.
 */
export async function preflightMerges(
  placements: MergePlacement[],
): Promise<string | null> {
  for (const placement of placements) {
    if (placement.kind !== "merge") continue;
    const [a, b] = placement.sources as [
      { path: string; fileName: string },
      { path: string; fileName: string },
    ];
    const [miA, miB] = await Promise.all([
      scanMediaInfo(a.path),
      scanMediaInfo(b.path),
    ]);
    if (!miA || !miB) {
      return `Season pack contains a split episode that MediaInfo cannot read — nothing imported. Could not scan "${miA ? b.fileName : a.fileName}".`;
    }
    if (!tracksCompatible(miA, miB)) {
      return `Season pack contains a split episode whose parts are not mergeable — nothing imported. "${a.fileName}" and "${b.fileName}" have different track layouts.`;
    }
  }
  return null;
}
