import type { TranscodeJobSettings } from "@rawkoon/shared/types";

export function formatBytes(bytes: string | number | bigint): string {
  const n = Number(bytes);
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

export function formatDuration(secs: number): string {
  if (secs < 60) return "<1 min";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function settingsKey(s: TranscodeJobSettings): string {
  return JSON.stringify([
    s.codec,
    s.encoder,
    s.resolution,
    s.mode,
    s.preset,
    s.quality ?? null,
    s.speed,
    s.targetVideoKbps ?? null,
    s.convertLosslessAudio,
  ]);
}

export function targetKbpsFromGb(
  gbPerFile: number,
  fileCount: number,
  totalAudioBytes: number,
  totalDurationSecs: number,
): number {
  if (totalDurationSecs <= 0) return 100;
  const videoBits = (gbPerFile * 1e9 * fileCount - totalAudioBytes) * 8;
  return Math.max(100, Math.round(videoBits / totalDurationSecs / 1000));
}

export function derivedMbps(kbps: number): string {
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}
