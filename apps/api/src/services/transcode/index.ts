import { stat, statfs } from "node:fs/promises";
import { statFileFingerprint } from "@rawkoon/api/utils/medias/fileFingerprint";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";
import { detectCapabilities } from "@rawkoon/api/services/transcode/capabilities";
import { TranscodeDispatcher } from "@rawkoon/api/services/transcode/dispatcher";
import { runFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import { transcodeNotifier } from "@rawkoon/api/services/transcode/notify";
import type { PipelineDeps } from "@rawkoon/api/services/transcode/pipeline";
import { probeFile } from "@rawkoon/api/services/transcode/probe";
import { prismaTranscodeRepo } from "@rawkoon/api/services/transcode/repo";
import { rescanTranscodedFile } from "@rawkoon/api/services/transcode/rescanFile";
import { nodeSwapFs } from "@rawkoon/api/services/transcode/swap";

export const transcodeDeps: PipelineDeps = {
  mapPath: remapPath,
  probe: probeFile,
  run: runFfmpeg,
  fingerprint: statFileFingerprint,
  nlink: async (p) => Number((await stat(p)).nlink),
  freeBytes: async (dir) => {
    const s = await statfs(dir, { bigint: true });
    return s.bavail * s.bsize;
  },
  fs: nodeSwapFs,
  capabilities: () => detectCapabilities(),
  rescan: async (token) => {
    const [id, path] = token.split(/\|(.*)/s);
    await rescanTranscodedFile(Number(id), path);
  },
};

export const transcodeDispatcher = new TranscodeDispatcher(
  prismaTranscodeRepo,
  transcodeDeps,
  transcodeNotifier,
);
