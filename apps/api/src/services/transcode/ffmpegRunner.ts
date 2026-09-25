export interface FfmpegProgress {
  outTimeSecs: number | null;
  fps: number | null;
  speed: number | null;
  totalSize: number | null;
  done: boolean;
}

export interface RunResult {
  code: number | null;
  signal: string | null;
  stderr: string;
  aborted: boolean;
}

export type RunFfmpeg = (
  args: string[],
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: FfmpegProgress) => void;
    nice?: boolean;
  },
) => Promise<RunResult>;

function n(v: string | undefined): number | null {
  if (v == null) return null;
  const x = Number.parseFloat(v);
  return Number.isFinite(x) ? x : null;
}

export function parseProgressBlock(block: string): FfmpegProgress {
  const kv: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const us = n(kv.out_time_us);
  return {
    outTimeSecs: us == null ? null : us / 1_000_000,
    fps: n(kv.fps),
    speed: n(kv.speed?.replace(/x$/, "")),
    totalSize: n(kv.total_size),
    done: kv.progress === "end",
  };
}

export function describeFailure(r: RunResult): string {
  if (r.aborted) return "Cancelled";
  if (r.signal === "SIGKILL") return "ffmpeg killed (out of memory?)";
  const last = r.stderr.trim().split("\n").filter(Boolean).at(-1) ?? "";
  return `ffmpeg exited ${r.code ?? r.signal}: ${last}`.trim().slice(0, 500);
}

export const runFfmpeg: RunFfmpeg = async (args, opts) => {
  if (opts.signal?.aborted)
    return { code: null, signal: null, stderr: "", aborted: true };
  const cmd = opts.nice ? ["nice", "-n", "10", ...args] : args;
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  let aborted = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    aborted = true;
    proc.kill("SIGTERM");
    killTimer = setTimeout(() => proc.kill("SIGKILL"), 10_000);
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const readProgress = (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let idx = buf.search(/progress=(continue|end)\n/);
      while (idx >= 0) {
        const end = buf.indexOf("\n", idx) + 1;
        opts.onProgress?.(parseProgressBlock(buf.slice(0, end)));
        buf = buf.slice(end);
        idx = buf.search(/progress=(continue|end)\n/);
      }
    }
  })();
  const stderrP = new Response(proc.stderr).text();
  const code = await proc.exited;
  await readProgress;
  const stderr = (await stderrP).slice(-4000);
  if (killTimer) clearTimeout(killTimer);
  opts.signal?.removeEventListener("abort", onAbort);
  return { code, signal: proc.signalCode ?? null, stderr, aborted };
};
