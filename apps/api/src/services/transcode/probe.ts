type RawStream = {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  color_primaries?: string;
  color_transfer?: string;
  color_space?: string;
  channels?: number;
  bit_rate?: string;
  tags?: Record<string, string>;
  disposition?: Record<string, number>;
  side_data_list?: { side_data_type?: string; dv_profile?: number }[];
};

type RawProbe = {
  format?: { duration?: string; size?: string; bit_rate?: string };
  streams?: RawStream[];
};

export interface ProbeStream {
  index: number;
  type: "video" | "audio" | "subtitle" | "attachment" | "data";
  ordinal: number;
  codec: string;
  profile: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  pixFmt: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorSpace: string | null;
  channels: number | null;
  bitRate: number | null;
  language: string | null;
  title: string | null;
  attachedPic: boolean;
  dvProfile: number | null;
}

export interface SourceProbe {
  durationSecs: number;
  sizeBytes: bigint;
  bitRate: number | null;
  streams: ProbeStream[];
  video: ProbeStream | null;
  isHdr: boolean;
  dvProfile: number | null;
}

const TYPES = new Set(["video", "audio", "subtitle", "attachment", "data"]);

function num(v: string | number | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function rate(v: string | undefined): number | null {
  if (!v) return null;
  const [a, b] = v.split("/").map(Number);
  if (!a || !b) return null;
  return a / b;
}

export function parseProbe(json: unknown): SourceProbe {
  const raw = (json ?? {}) as RawProbe;
  const counters: Record<string, number> = {};
  const streams: ProbeStream[] = [];
  for (const s of raw.streams ?? []) {
    const type = s.codec_type ?? "data";
    if (!TYPES.has(type)) continue;
    const ordinal = counters[type] ?? 0;
    counters[type] = ordinal + 1;
    const dv = s.side_data_list?.find(
      (d) => d.side_data_type === "DOVI configuration record",
    );
    streams.push({
      index: s.index ?? streams.length,
      type: type as ProbeStream["type"],
      ordinal,
      codec: s.codec_name ?? "unknown",
      profile: s.profile ?? null,
      width: s.width ?? null,
      height: s.height ?? null,
      fps: rate(s.avg_frame_rate) ?? rate(s.r_frame_rate),
      pixFmt: s.pix_fmt ?? null,
      colorPrimaries: s.color_primaries ?? null,
      colorTransfer: s.color_transfer ?? null,
      colorSpace: s.color_space ?? null,
      channels: s.channels ?? null,
      // Matroska often omits bit_rate for lossless audio but keeps mkvmerge statistics tags.
      bitRate:
        num(s.bit_rate) ??
        num(s.tags?.BPS) ??
        num(
          Object.entries(s.tags ?? {}).find(([k]) => k.startsWith("BPS-"))?.[1],
        ),
      language: s.tags?.language ?? null,
      title: s.tags?.title ?? null,
      attachedPic: s.disposition?.attached_pic === 1,
      dvProfile: dv?.dv_profile ?? null,
    });
  }
  const video =
    streams.find((s) => s.type === "video" && !s.attachedPic) ?? null;
  const transfer = video?.colorTransfer ?? "";
  return {
    durationSecs: num(raw.format?.duration) ?? 0,
    sizeBytes: BigInt(raw.format?.size ?? "0"),
    bitRate: num(raw.format?.bit_rate),
    streams,
    video,
    isHdr: transfer === "smpte2084" || transfer === "arib-std-b67",
    dvProfile: video?.dvProfile ?? null,
  };
}

export async function probeFile(path: string): Promise<SourceProbe> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), 60_000);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (code !== 0)
    throw new Error(`ffprobe failed: ${err.trim().slice(0, 300)}`);
  return parseProbe(JSON.parse(out));
}
