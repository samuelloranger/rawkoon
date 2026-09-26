import { basename } from "node:path";
import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";
import { prisma } from "@rawkoon/api/db";
import { emitLibraryUpdate } from "@rawkoon/api/services/libraryEvents";
import { triggerJellyfinLibraryScan } from "@rawkoon/api/services/jellyfinLibraryRefresh";
import {
  fingerprintDbFields,
  statFileFingerprint,
} from "@rawkoon/api/utils/medias/fileFingerprint";
import {
  remapPath,
  scanMediaInfo,
} from "@rawkoon/api/utils/medias/mediainfoScanner";

export async function rescanTranscodedFile(
  mediaFileId: number,
  finalDbPath: string,
): Promise<void> {
  const fp = await statFileFingerprint(remapPath(finalDbPath));
  if (!fp) throw new Error("Output file not found after replace");
  const mi = await scanMediaInfo(finalDbPath);
  if (!mi) throw new Error("mediainfo could not read the output");
  const row = await prisma.mediaFile.update({
    where: { id: mediaFileId },
    data: {
      filePath: finalDbPath,
      fileName: basename(finalDbPath),
      ...fingerprintDbFields(fp),
      durationSecs: mi.durationSecs,
      videoCodec: mi.videoCodec,
      videoProfile: mi.videoProfile,
      width: mi.width,
      height: mi.height,
      frameRate: mi.frameRate,
      bitDepth: mi.bitDepth,
      videoBitrate: mi.videoBitrate,
      hdrFormat: mi.hdrFormat,
      resolution: mi.resolution,
      audioTracks: mi.audioTracks as object[],
      subtitleTracks: mi.subtitleTracks as object[],
      languageTags: classifyLanguageTags(
        mi.audioTracks as LibraryAudioTrack[],
        null,
      ),
      scannedAt: new Date(),
    },
    select: { mediaId: true, episode: { select: { mediaId: true } } },
  });
  const mediaId = row.mediaId ?? row.episode?.mediaId;
  if (mediaId) emitLibraryUpdate(mediaId);
  void triggerJellyfinLibraryScan().catch(() => {});
}
