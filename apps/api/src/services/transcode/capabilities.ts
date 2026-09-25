import { readdir } from "node:fs/promises";
import type { TranscodeCombo } from "@rawkoon/shared/types";

export interface Capabilities {
  combos: TranscodeCombo[];
  vaapiDevice: string | null;
  deviceLabel: string | null;
  vaapiUnavailableReason: string | null;
}

export function parseEncoderList(out: string): Set<string> {
  const names = new Set<string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^\s[VAS][.A-Z]{5}\s+(\S+)/);
    if (m && m[1] !== "=") names.add(m[1]);
  }
  return names;
}

async function exec(args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const t = setTimeout(() => p.kill(), 20_000);
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  clearTimeout(t);
  return { code, out };
}

async function vaapiWorks(device: string, encoder: string): Promise<boolean> {
  const r = await exec([
    "ffmpeg",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-init_hw_device",
    `vaapi=va:${device}`,
    "-filter_hw_device",
    "va",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x240:d=0.2",
    "-vf",
    "format=nv12,hwupload",
    "-c:v",
    encoder,
    "-f",
    "null",
    "-",
  ]);
  return r.code === 0;
}

let cached: Capabilities | null = null;

export async function detectCapabilities(force = false): Promise<Capabilities> {
  if (cached && !force) return cached;
  const combos: TranscodeCombo[] = [];
  const enc = parseEncoderList(
    (await exec(["ffmpeg", "-hide_banner", "-encoders"])).out,
  );
  if (enc.has("libx265")) combos.push({ codec: "hevc", encoder: "software" });
  if (enc.has("libsvtav1")) combos.push({ codec: "av1", encoder: "software" });

  let device: string | null = null;
  let reason: string | null = null;
  try {
    const node = (await readdir("/dev/dri"))
      .filter((f) => f.startsWith("renderD"))
      .sort()[0];
    device = node ? `/dev/dri/${node}` : null;
  } catch {
    device = null;
  }
  if (!device) {
    reason = "No GPU render device (/dev/dri) in the container";
  } else {
    for (const [codec, name] of [
      ["hevc", "hevc_vaapi"],
      ["av1", "av1_vaapi"],
    ] as const) {
      if (enc.has(name) && (await vaapiWorks(device, name)))
        combos.push({ codec, encoder: "vaapi" });
    }
    if (!combos.some((c) => c.encoder === "vaapi")) {
      reason = "GPU found but VAAPI encoding failed (missing driver?)";
      device = null;
    }
  }
  cached = {
    combos,
    vaapiDevice: device,
    deviceLabel: device ? `VAAPI · ${device.split("/").at(-1)}` : null,
    vaapiUnavailableReason: reason,
  };
  return cached;
}
