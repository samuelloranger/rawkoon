import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  TranscodeEstimate,
  TranscodeEstimateFile,
  TranscodeExcludedFile,
  TranscodeJobSettings,
  TranscodeSelection,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";
import { detectCapabilities } from "@rawkoon/api/services/transcode/capabilities";
import {
  applyRatio,
  type FileEstimate,
  roughEstimate,
  SAMPLE_CLIPS,
  sampleRatios,
} from "@rawkoon/api/services/transcode/estimate";
import { runFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import {
  eac3BitrateFor,
  isLosslessAudio,
} from "@rawkoon/api/services/transcode/presets";
import {
  probeFile,
  type SourceProbe,
} from "@rawkoon/api/services/transcode/probe";
import {
  type CandidateFile,
  exclusionReason,
  loadCandidates,
} from "@rawkoon/api/services/transcode/selection";

const probeCache = new Map<string, SourceProbe>();
const refineCache = new Map<
  string,
  { at: number; value: { est: FileEstimate; rangePct: number } }
>();
const REFINE_TTL_MS = 30 * 60_000;

async function cachedProbe(f: CandidateFile): Promise<SourceProbe | null> {
  const key = `${f.id}:${f.sizeBytes}:${f.fileMtimeMs}`;
  const hit = probeCache.get(key);
  if (hit) return hit;
  try {
    const p = await probeFile(remapPath(f.dbPath));
    probeCache.set(key, p);
    return p;
  } catch {
    return null;
  }
}

async function nlinkOf(f: CandidateFile): Promise<number> {
  try {
    return Number((await stat(remapPath(f.dbPath))).nlink);
  } catch {
    return 1;
  }
}

export async function activeFileIds(ids: number[]): Promise<Set<number>> {
  const rows = await prisma.transcodeJob.findMany({
    where: { mediaFileId: { in: ids }, status: { in: ["queued", "running"] } },
    select: { mediaFileId: true },
  });
  return new Set(rows.map((r) => r.mediaFileId!));
}

export async function resolveEligible(
  sel: TranscodeSelection,
  settings: TranscodeJobSettings,
) {
  const caps = await detectCapabilities();
  const candidates = await loadCandidates(sel);
  const active = await activeFileIds(candidates.map((c) => c.id));
  const eligible: { file: CandidateFile; probe: SourceProbe }[] = [];
  const excluded: TranscodeExcludedFile[] = [];
  for (const file of candidates) {
    const probe = await cachedProbe(file);
    const reason = exclusionReason({
      path: file.dbPath,
      probe,
      settings,
      active: active.has(file.id),
      caps,
    });
    if (reason) excluded.push({ file_id: file.id, title: file.title, reason });
    else eligible.push({ file, probe: probe! });
  }
  return { eligible, excluded, caps };
}

function pickSamples<T extends { file: CandidateFile }>(items: T[]): T[] {
  if (items.length <= 3) return items;
  const sorted = [...items].sort((a, b) =>
    Number(a.file.sizeBytes - b.file.sizeBytes),
  );
  return [
    sorted[sorted.length - 1],
    sorted[Math.floor(sorted.length / 2)],
    sorted[0],
  ];
}

export async function estimateSelection(
  sel: TranscodeSelection,
  settings: TranscodeJobSettings,
  refine: boolean,
): Promise<TranscodeEstimate> {
  const { eligible, excluded, caps } = await resolveEligible(sel, settings);
  const settingsKey = JSON.stringify(settings);
  let ratio: number | null = null;
  let rangePct = settings.mode === "target" ? 3 : 15;
  let refinedFiles = 0;
  let fps: number | null = null;

  if (refine && settings.mode === "quality" && eligible.length) {
    const ratios: number[] = [];
    for (const item of pickSamples(eligible)) {
      const key = `${item.file.id}:${settingsKey}`;
      const hit = refineCache.get(key);
      if (hit && Date.now() - hit.at < REFINE_TTL_MS) {
        ratios.push(
          Number(hit.value.est.videoBytes) /
            Math.max(1, Number(roughEstimate(item.probe, settings).videoBytes)),
        );
        continue;
      }
      const workDir = join(tmpdir(), "rawkoon-transcode", String(item.file.id));
      await mkdir(workDir, { recursive: true });
      try {
        const r = await sampleRatios({
          input: remapPath(item.file.dbPath),
          probe: item.probe,
          settings,
          workDir,
          run: runFfmpeg,
          threads: 4,
          vaapiDevice: caps.vaapiDevice,
          statSize: async (p) => (await stat(p)).size,
        });
        const applied = applyRatio(item.probe, settings, r.ratios, r.fps);
        refineCache.set(key, { at: Date.now(), value: applied });
        ratios.push(
          Number(applied.est.videoBytes) /
            Math.max(1, Number(roughEstimate(item.probe, settings).videoBytes)),
        );
        rangePct = Math.max(5, applied.rangePct);
        fps = r.fps;
        refinedFiles++;
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    if (ratios.length)
      ratio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }

  const files: TranscodeEstimateFile[] = [];
  let totalSrc = 0n,
    totalEst = 0n,
    totalAudio = 0n,
    freesNow = 0n,
    freesLater = 0n,
    growth = 0n;
  let eta = 0,
    duration = 0;
  for (const { file, probe } of eligible) {
    const rough = roughEstimate(probe, settings);
    const video =
      ratio != null
        ? BigInt(Math.round(Number(rough.videoBytes) * ratio))
        : rough.videoBytes;
    const total = ((video + rough.audioBytes) * 101n) / 100n;
    const nlink = await nlinkOf(file);
    const saved = file.sizeBytes > total ? file.sizeBytes - total : 0n;
    if (nlink > 1) {
      freesLater += saved;
      growth += total;
    } else freesNow += saved;
    totalSrc += file.sizeBytes;
    totalEst += total;
    totalAudio += rough.audioBytes;
    duration += probe.durationSecs;
    eta +=
      fps && probe.video?.fps
        ? Math.round((probe.durationSecs * probe.video.fps) / fps)
        : rough.etaSecs;
    files.push({
      file_id: file.id,
      title: file.title,
      source_bytes: String(file.sizeBytes),
      estimated_bytes: String(total),
      nlink,
      duration_secs: probe.durationSecs,
    });
  }

  const first = eligible[0]?.probe;
  const audioChanges = first
    ? first.streams.filter(isLosslessAudio).map((a) => ({
        label: `${(a.language ?? "und").toUpperCase()} · ${a.codec.toUpperCase()}${a.channels ? ` ${a.channels}ch` : ""}`,
        to: `EAC3 ${eac3BitrateFor(a.channels).kbps}k`,
      }))
    : [];

  return {
    files,
    excluded,
    total_source_bytes: String(totalSrc),
    total_estimated_bytes: String(totalEst),
    total_duration_secs: Math.round(duration),
    total_audio_bytes: String(totalAudio),
    range_pct: rangePct,
    frees_now_bytes: String(freesNow),
    frees_after_seeding_bytes: String(freesLater),
    temporary_growth_bytes: String(growth),
    eta_secs: eta,
    source:
      settings.mode === "target"
        ? "target"
        : refinedFiles
          ? "refined"
          : "rough",
    refined_files: refinedFiles,
    refined_clips: refinedFiles * SAMPLE_CLIPS,
    audio_changes: audioChanges,
    source_height: first?.video?.height ?? null,
    source_width: first?.video?.width ?? null,
  };
}
