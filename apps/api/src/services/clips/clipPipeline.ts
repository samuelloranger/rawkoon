import { createHash } from "node:crypto";
import { prisma } from "@rawkoon/api/db";
import { detectCapabilities } from "@rawkoon/api/services/transcode/capabilities";
import { probeFile } from "@rawkoon/api/services/transcode/probe";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";
import {
  CLIP_SECONDS,
  buildClipArgs,
  buildCropDetectArgs,
  parseCrop,
  plausibleCrop,
} from "@rawkoon/api/services/clips/clipArgs";
import { assertClipsRootSafe } from "@rawkoon/api/services/clips/clipGuard";
import {
  discardTemp,
  publish,
  reserveTempPath,
} from "@rawkoon/api/services/clips/clipStore";

const MOVIE_START = 0.25;
const SEASON_START = 0.1;
const FFMPEG_TIMEOUT_MS = 120_000;

export const sourceKeyFor = (filePath: string) =>
  createHash("sha1").update(filePath).digest("hex");

export interface ClipSource {
  mediaFileId: number;
  filePath: string;
  durationSecs: number | null;
}

/** Movie: its first file. Season: the first file of the lowest-numbered episode that has one. */
export async function pickSource(clip: {
  kind: string;
  mediaId: number;
  seasonNumber: number;
}): Promise<ClipSource | null> {
  const file =
    clip.kind === "movie"
      ? await prisma.mediaFile.findFirst({
          where: { mediaId: clip.mediaId, episodeId: null },
          orderBy: { id: "asc" },
        })
      : await prisma.mediaFile.findFirst({
          where: {
            episode: { mediaId: clip.mediaId, season: clip.seasonNumber },
          },
          orderBy: [{ episode: { episode: "asc" } }, { id: "asc" }],
        });
  return file
    ? {
        mediaFileId: file.id,
        filePath: file.filePath,
        durationSecs: file.durationSecs,
      }
    : null;
}

export function pickStart(kind: string, durationSecs: number): number {
  const raw = durationSecs * (kind === "movie" ? MOVIE_START : SEASON_START);
  return clampStart(raw, durationSecs);
}

export function clampStart(startSec: number, durationSecs: number): number {
  const max = Math.max(0, durationSecs - CLIP_SECONDS);
  return Math.round(Math.min(Math.max(0, startSec), max) * 10) / 10;
}

async function exec(
  args: string[],
): Promise<{ code: number | null; stderr: string }> {
  const proc = Bun.spawn(args, {
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  const timer = setTimeout(() => proc.kill(), FFMPEG_TIMEOUT_MS);
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, stderr };
}

export interface ClipDeps {
  exec: typeof exec;
  probeDuration: (path: string) => Promise<number>;
  vaapiDevice: () => Promise<string | null>;
  isHdr: (path: string) => Promise<boolean>;
  frameSize: (
    path: string,
  ) => Promise<{ width: number | null; height: number | null } | null>;
}

const defaultDeps: ClipDeps = {
  exec,
  probeDuration: async (p) => (await probeFile(p)).durationSecs,
  vaapiDevice: async () => (await detectCapabilities()).vaapiDevice,
  isHdr: async (p) => (await probeFile(p)).isHdr,
  // Unrotated stored size: a rotated source's crop then fails the check and is cut uncropped
  frameSize: async (p) => (await probeFile(p)).video,
};

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Cuts one clip. Never throws: the outcome lands on the row. */
export async function cutClip(
  clipId: number,
  deps: ClipDeps = defaultDeps,
): Promise<void> {
  const clip = await prisma.previewClip.findUnique({ where: { id: clipId } });
  if (!clip || clip.status === "done" || clip.status === "running") return;

  const settings = await prisma.clipSettings.findUnique({ where: { id: 1 } });
  // Left queued: enabling again re-enqueues every queued row.
  if (!settings?.enabled) return;

  const fail = (error: string) =>
    prisma.previewClip.updateMany({
      where: { id: clipId },
      data: { status: "failed", error, finishedAt: new Date() },
    });

  try {
    await assertClipsRootSafe();
  } catch (e) {
    await fail(errMsg(e));
    return;
  }

  const source = await pickSource(clip);
  if (!source) {
    await fail("No source file");
    return;
  }

  await prisma.previewClip.updateMany({
    where: { id: clipId },
    data: {
      status: "running",
      error: null,
      startedAt: new Date(),
      finishedAt: null,
    },
  });

  let tempName: string | null = null;
  try {
    const input = remapPath(source.filePath);
    const duration = source.durationSecs ?? (await deps.probeDuration(input));
    const startSec = clampStart(
      clip.startSec ?? pickStart(clip.kind, duration),
      duration,
    );

    const frame = await deps.frameSize(input);
    const crop = plausibleCrop(
      parseCrop((await deps.exec(buildCropDetectArgs(input, startSec))).stderr),
      frame?.width,
      frame?.height,
    );
    const temp = await reserveTempPath(clipId);
    tempName = temp.name;
    const run = await deps.exec(
      buildClipArgs({
        source: input,
        startSec,
        crop,
        hdr: await deps.isHdr(input),
        vaapiDevice: await deps.vaapiDevice(),
        output: temp.path,
      }),
    );
    if (run.code !== 0)
      throw new Error(
        `ffmpeg exited ${run.code}: ${run.stderr.trim().slice(-300)}`,
      );

    const bytes = await publish(clipId, temp.name);
    tempName = null;
    await prisma.previewClip.updateMany({
      where: { id: clipId },
      data: {
        status: "done",
        startSec,
        bytes,
        error: null,
        sourceMediaFileId: source.mediaFileId,
        sourceKey: sourceKeyFor(source.filePath),
        finishedAt: new Date(),
      },
    });
  } catch (e) {
    if (tempName) await discardTemp(clipId, tempName).catch(() => undefined);
    await fail(errMsg(e));
  }
}
