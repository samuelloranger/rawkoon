import type { Job } from "bullmq";
import { prisma } from "@rawkoon/api/db";
import {
  scanMediaInfo,
  remapPath,
} from "@rawkoon/api/utils/medias/mediainfoScanner";
import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";

export interface LibraryRemuxJobData {
  file_id: number;
  keep_audio_track_indices: number[];
  keep_subtitle_track_indices: number[];
}

export interface LibraryRemuxResult {
  status: "remuxed" | "skipped" | "error";
  message?: string;
}

interface MkvTrack {
  id: number;
  type: string;
  properties: {
    language?: string;
    track_name?: string;
  };
}

export async function processLibraryRemuxFileJob(
  job: Job<LibraryRemuxJobData>,
): Promise<LibraryRemuxResult> {
  const { file_id, keep_audio_track_indices, keep_subtitle_track_indices } =
    job.data;
  const keepAudioIndexSet = new Set(keep_audio_track_indices);
  const keepSubIndexSet = new Set(keep_subtitle_track_indices);

  const bin = Bun.which("mkvmerge");
  if (!bin) {
    throw new Error("mkvmerge not found — add mkvtoolnix to the Docker image");
  }

  const file = await prisma.mediaFile.findUnique({
    where: { id: file_id },
    select: { id: true, filePath: true },
  });
  if (!file) return { status: "error", message: "File not found in database" };
  if (!file.filePath.toLowerCase().endsWith(".mkv")) {
    return { status: "skipped", message: "Not an MKV file" };
  }

  const resolvedPath = remapPath(file.filePath);

  // Identify current tracks via mkvmerge
  const identProc = Bun.spawn([bin, "-J", resolvedPath], { stderr: "ignore" });
  const identTimeout = setTimeout(() => identProc.kill(), 30_000);
  const identRaw = await new Response(identProc.stdout).text();
  clearTimeout(identTimeout);

  if ((await identProc.exited) !== 0 || !identRaw.trim()) {
    return { status: "error", message: "mkvmerge could not identify the file" };
  }

  const mkvJson = JSON.parse(identRaw) as { tracks?: MkvTrack[] };
  const tracks = mkvJson.tracks ?? [];
  const audioTracks = tracks.filter((t) => t.type === "audio");
  const subtitleTracks = tracks.filter((t) => t.type === "subtitles");

  // Map keep_audio_track_indices → mkvmerge track IDs
  // audioTracks[N] in mkvmerge output corresponds to index N in DB audio_tracks
  const keptAudioIds: number[] = [];
  audioTracks.forEach((t, idx) => {
    if (keepAudioIndexSet.has(idx)) keptAudioIds.push(t.id);
  });

  // Map keep_subtitle_track_indices → mkvmerge track IDs
  const keptSubIds: number[] = [];
  subtitleTracks.forEach((t, idx) => {
    if (keepSubIndexSet.has(idx)) keptSubIds.push(t.id);
  });

  // Nothing to do
  if (
    keptAudioIds.length === audioTracks.length &&
    keptSubIds.length === subtitleTracks.length
  ) {
    return { status: "skipped", message: "All tracks already match selection" };
  }

  if (keptAudioIds.length === 0) {
    return {
      status: "error",
      message: "Selection would remove all audio tracks",
    };
  }

  const tmpPath = `${resolvedPath}.remux.tmp.mkv`;
  const args = [
    bin,
    "-o",
    tmpPath,
    "--audio-tracks",
    keptAudioIds.join(","),
    ...(keptSubIds.length > 0
      ? ["--subtitle-tracks", keptSubIds.join(",")]
      : ["--no-subtitles"]),
    resolvedPath,
  ];

  const remuxProc = Bun.spawn(args, { stderr: "ignore" });
  const remuxTimeout = setTimeout(() => remuxProc.kill(), 15 * 60_000);
  const remuxExit = await remuxProc.exited;
  clearTimeout(remuxTimeout);

  if (remuxExit !== 0) {
    try {
      if (await Bun.file(tmpPath).exists()) {
        const rm = Bun.spawn(["rm", "-f", tmpPath], { stderr: "ignore" });
        await rm.exited;
      }
    } catch {
      // Best-effort temp file cleanup.
    }
    return {
      status: "error",
      message: `mkvmerge exited with code ${remuxExit}`,
    };
  }

  // Atomically replace the original
  const mv = Bun.spawn(["mv", "-f", tmpPath, resolvedPath], {
    stderr: "ignore",
  });
  if ((await mv.exited) !== 0) {
    return {
      status: "error",
      message: "Failed to replace original file after remux",
    };
  }

  // Re-scan and update DB
  const mi = await scanMediaInfo(file.filePath);
  if (mi) {
    const tags = classifyLanguageTags(
      mi.audioTracks as LibraryAudioTrack[],
      null,
    );
    await prisma.mediaFile.update({
      where: { id: file.id },
      data: {
        audioTracks: mi.audioTracks as object[],
        subtitleTracks: mi.subtitleTracks as object[],
        languageTags: tags,
        scannedAt: new Date(),
      },
    });
  }

  return { status: "remuxed" };
}
