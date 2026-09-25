import { describe, expect, it } from "bun:test";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { parseProbe } from "@rawkoon/api/services/transcode/probe";
import {
  type PipelineDeps,
  type PipelineJob,
  runPipeline,
} from "@rawkoon/api/services/transcode/pipeline";
import type { SwapFs } from "@rawkoon/api/services/transcode/swap";

const settings: TranscodeJobSettings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};

const srcProbe = parseProbe({
  format: { duration: "100", size: "1000" },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      r_frame_rate: "24/1",
    },
    {
      index: 1,
      codec_type: "audio",
      codec_name: "ac3",
      tags: { language: "eng" },
    },
  ],
});
const outProbe = parseProbe({
  format: { duration: "100", size: "400" },
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "hevc",
      width: 1920,
      height: 1080,
    },
    {
      index: 1,
      codec_type: "audio",
      codec_name: "ac3",
      tags: { language: "eng" },
    },
  ],
});

const fp = { sizeBytes: 1000n, mtimeMs: 5n, dev: "1", ino: "2" };

function makeDeps(over: Partial<PipelineDeps> = {}) {
  const calls: string[] = [];
  const memFs: SwapFs = {
    rename: async (a, b) => {
      calls.push(`rename ${a} -> ${b}`);
    },
    copyFile: async () => {},
    link: async (a, b) => {
      calls.push(`link ${a} -> ${b}`);
    },
    size: async () => 400,
    unlink: async (p) => {
      calls.push(`unlink ${p}`);
    },
    exists: async () => false,
    fsync: async () => {},
  };
  let probes = 0;
  const deps: PipelineDeps = {
    mapPath: (p) => p,
    probe: async () => (probes++ === 0 ? srcProbe : outProbe),
    run: async (args, opts) => {
      if (args.includes("-progress"))
        opts.onProgress?.({
          outTimeSecs: 50,
          fps: 100,
          speed: 4,
          totalSize: 200,
          done: false,
        });
      const ssim = args.includes("-lavfi");
      return {
        code: 0,
        signal: null,
        stderr: ssim ? "SSIM All:0.990 (20)" : "",
        aborted: false,
      };
    },
    fingerprint: async () => fp,
    nlink: async () => 2,
    freeBytes: async () => 10_000n,
    fs: memFs,
    capabilities: async () => ({
      combos: [{ codec: "hevc", encoder: "software" }],
      vaapiDevice: null,
      deviceLabel: null,
      vaapiUnavailableReason: "none",
    }),
    rescan: async () => {
      calls.push("rescan");
    },
    ...over,
  };
  return { deps, calls };
}

const job: PipelineJob = {
  id: 1,
  settings,
  estimatedBytes: 400n,
  source: {
    dbPath: "/lib/a.mkv",
    sizeBytes: 1000n,
    fileMtimeMs: 5n,
    fileDev: "1",
    fileIno: "2",
  },
};
const opts = () => ({
  signal: new AbortController().signal,
  threads: 2,
  thresholds: { avg: 0.97, min: 0.95 },
});
const hooks = () => {
  const steps: string[] = [];
  const progress: number[] = [];
  return {
    steps,
    progress,
    h: {
      onStep: (s: string) => steps.push(s),
      onProgress: (p: { progress: number }) => progress.push(p.progress),
    },
  };
};

describe("runPipeline", () => {
  it("runs every step and swaps the file", async () => {
    const { deps, calls } = makeDeps();
    const hk = hooks();
    const r = await runPipeline(job, deps, hk.h as never, opts());
    expect(r).toMatchObject({
      ok: true,
      outputBytes: 400n,
      nlink: 2,
      finalDbPath: "/lib/a.mkv",
    });
    expect(hk.steps).toEqual([
      "preflight",
      "encode",
      "validate",
      "replace",
      "rescan",
    ]);
    expect(hk.progress[0]).toBeCloseTo(0.5);
    expect(calls).toContain("rename /lib/.a.rawkoon-tmp.mkv -> /lib/a.mkv");
    expect(calls.at(-1)).toBe("rescan");
  });

  it("fails preflight when the source changed since queueing", async () => {
    const { deps } = makeDeps({
      fingerprint: async () => ({ ...fp, mtimeMs: 99n }),
    });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r).toMatchObject({
      ok: false,
      error: "Source changed since queued",
    });
  });

  it("fails preflight without enough free space", async () => {
    const { deps } = makeDeps({ freeBytes: async () => 100n });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("free space");
  });

  it("refuses Dolby Vision profile 5", async () => {
    const dv5 = { ...srcProbe, dvProfile: 5 };
    const { deps } = makeDeps({ probe: async () => dv5 });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect((r as { error: string }).error).toContain("Dolby Vision profile 5");
  });

  it("fails validation and deletes tmp, leaving the source alone", async () => {
    const { deps, calls } = makeDeps({
      run: async (args) => ({
        code: 0,
        signal: null,
        stderr: args.includes("-lavfi") ? "All:0.900 (9)" : "",
        aborted: false,
      }),
    });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r.ok).toBe(false);
    expect((r as { ssimAvg: number }).ssimAvg).toBeCloseTo(0.9);
    expect(calls).toContain("unlink /lib/.a.rawkoon-tmp.mkv");
    expect(calls.some((c) => c.startsWith("rename"))).toBe(false);
  });

  it("pipeline aborts when fingerprint changes before replace", async () => {
    let n = 0;
    const { deps, calls } = makeDeps({
      fingerprint: async () => (n++ === 0 ? fp : { ...fp, ino: "999" }),
    });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r).toMatchObject({
      ok: false,
      error: "Source changed during encode",
    });
    expect(calls.some((c) => c.startsWith("rename"))).toBe(false);
  });

  it("reports cancellation", async () => {
    const { deps } = makeDeps({
      run: async () => ({ code: 255, signal: null, stderr: "", aborted: true }),
    });
    const r = await runPipeline(job, deps, hooks().h as never, opts());
    expect(r).toMatchObject({ ok: false, cancelled: true, error: "Cancelled" });
  });

  it("fails when VAAPI is chosen but unavailable", async () => {
    const { deps } = makeDeps();
    const r = await runPipeline(
      { ...job, settings: { ...settings, encoder: "vaapi" } },
      deps,
      hooks().h as never,
      opts(),
    );
    expect((r as { error: string }).error).toBe("VAAPI device not available");
  });
});

describe("runPipeline safety", () => {
  const mp4Job: PipelineJob = {
    ...job,
    source: { ...job.source, dbPath: "/lib/a.mp4" },
  };

  it("refuses when the new final path already exists, before encoding", async () => {
    let encodes = 0;
    const { deps } = makeDeps({
      run: async (args) => {
        if (args.includes("-progress")) encodes++;
        return { code: 0, signal: null, stderr: "", aborted: false };
      },
    });
    deps.fs.exists = async (p) => p === "/lib/a.mkv";
    const r = await runPipeline(mp4Job, deps, hooks().h as never, opts());
    expect(r).toMatchObject({ ok: false, error: "Destination already exists" });
    expect(encodes).toBe(0);
  });

  it("a cancel during preflight skips the encode", async () => {
    const ac = new AbortController();
    let encodes = 0;
    const { deps } = makeDeps({
      capabilities: async () => {
        ac.abort();
        return {
          combos: [],
          vaapiDevice: null,
          deviceLabel: null,
          vaapiUnavailableReason: "none",
        };
      },
      run: async (args) => {
        if (args.includes("-progress")) encodes++;
        return { code: 0, signal: null, stderr: "", aborted: false };
      },
    });
    const r = await runPipeline(job, deps, hooks().h as never, {
      ...opts(),
      signal: ac.signal,
    });
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(encodes).toBe(0);
  });

  it("a cancel during validation does not replace the file", async () => {
    const ac = new AbortController();
    const { deps, calls } = makeDeps();
    const h = {
      onStep: (s: string) => {
        if (s === "validate") ac.abort();
      },
      onProgress: () => {},
    };
    const r = await runPipeline(job, deps, h as never, {
      ...opts(),
      signal: ac.signal,
    });
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(
      calls.some((c) => c.startsWith("rename") || c.startsWith("link")),
    ).toBe(false);
  });

  it("waits for the replace step to be recorded before swapping", async () => {
    const order: string[] = [];
    const { deps } = makeDeps();
    const inner = deps.fs.rename;
    deps.fs.rename = async (a, b) => {
      order.push("rename");
      return inner(a, b);
    };
    const h = {
      onStep: (s: string) =>
        s === "replace"
          ? new Promise<void>((res) =>
              setTimeout(() => {
                order.push("step saved");
                res();
              }, 20),
            )
          : undefined,
      onProgress: () => {},
    };
    await runPipeline(job, deps, h as never, opts());
    expect(order).toEqual(["step saved", "rename"]);
  });
});
