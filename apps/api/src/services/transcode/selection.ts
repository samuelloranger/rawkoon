import { extname } from "node:path";
import type {
  TranscodeJobSettings,
  TranscodeSelection,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import type { Capabilities } from "@rawkoon/api/services/transcode/capabilities";
import type { SourceProbe } from "@rawkoon/api/services/transcode/probe";

export const VIDEO_EXTENSIONS = new Set([
  ".mkv",
  ".mp4",
  ".m4v",
  ".avi",
  ".mov",
  ".ts",
  ".m2ts",
  ".wmv",
  ".webm",
]);

export interface CandidateFile {
  id: number;
  title: string;
  dbPath: string;
  sizeBytes: bigint;
  mediaId: number | null;
  fileMtimeMs: bigint | null;
  fileDev: string | null;
  fileIno: string | null;
}

export function exclusionReason(o: {
  path: string;
  probe: SourceProbe | null;
  settings: TranscodeJobSettings;
  active: boolean;
  caps: Capabilities;
}): string | null {
  if (!VIDEO_EXTENSIONS.has(extname(o.path).toLowerCase()))
    return "Not a video file";
  if (o.active) return "Already queued";
  if (
    !o.caps.combos.some(
      (c) => c.codec === o.settings.codec && c.encoder === o.settings.encoder,
    )
  )
    return "Encoder not available";
  if (!o.probe?.video) return "Could not read the file";
  if (o.probe.dvProfile === 5)
    return "Dolby Vision profile 5 has no HDR10 fallback";
  if (
    o.settings.resolution !== "keep" &&
    (o.probe.video.height ?? 0) <= o.settings.resolution
  ) {
    return `Already ${o.settings.resolution}p or lower`;
  }
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export async function loadCandidates(
  sel: TranscodeSelection,
): Promise<CandidateFile[]> {
  const where = sel.file_ids?.length
    ? { id: { in: sel.file_ids } }
    : sel.season != null
      ? { episode: { mediaId: sel.media_id, season: sel.season } }
      : {
          OR: [
            { mediaId: sel.media_id },
            { episode: { mediaId: sel.media_id } },
          ],
        };
  const rows = await prisma.mediaFile.findMany({
    where,
    select: {
      id: true,
      filePath: true,
      sizeBytes: true,
      mediaId: true,
      fileMtimeMs: true,
      fileDev: true,
      fileIno: true,
      media: { select: { title: true } },
      episode: {
        select: {
          season: true,
          episode: true,
          mediaId: true,
          media: { select: { title: true } },
        },
      },
    },
    orderBy: [
      { episode: { season: "asc" } },
      { episode: { episode: "asc" } },
      { id: "asc" },
    ],
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.episode
      ? `${r.episode.media.title} — S${pad(r.episode.season)}E${pad(r.episode.episode)}`
      : (r.media?.title ?? `File ${r.id}`),
    dbPath: r.filePath,
    sizeBytes: r.sizeBytes,
    mediaId: r.mediaId ?? r.episode?.mediaId ?? null,
    fileMtimeMs: r.fileMtimeMs,
    fileDev: r.fileDev,
    fileIno: r.fileIno,
  }));
}
