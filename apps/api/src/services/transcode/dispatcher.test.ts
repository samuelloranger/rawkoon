import { describe, expect, it, mock } from "bun:test";
import type { TranscodeQueueSettings } from "@rawkoon/shared/types";

type PipelineImpl = (
  job: unknown,
  deps: unknown,
  hooks: any,
  opts: { signal: AbortSignal },
) => Promise<unknown>;
let pipelineImpl: PipelineImpl | null = null;
mock.module("@rawkoon/api/services/transcode/pipeline", () => ({
  runPipeline: async (...args: Parameters<PipelineImpl>) =>
    pipelineImpl
      ? pipelineImpl(...args)
      : defaultPipeline(...(args as unknown as [unknown, unknown, never])),
}));
const defaultPipeline = async (
  _job: unknown,
  _deps: unknown,
  hooks: { onStep: (s: string) => void; onProgress: (p: unknown) => void },
) => {
  hooks.onStep("encode");
  hooks.onProgress({
    progress: 0.4,
    fps: 10,
    speed: 1,
    eta_secs: 5,
    current_bytes: "1",
  });
  return {
    ok: true,
    outputBytes: 10n,
    ssimAvg: 0.99,
    ssimMin: 0.98,
    nlink: 1,
    finalDbPath: "/a.mkv",
  };
};

const { TranscodeDispatcher } = await import(
  "@rawkoon/api/services/transcode/dispatcher"
);

const baseSettings: TranscodeQueueSettings = {
  paused: false,
  window_enabled: false,
  window_start: "01:00",
  window_end: "08:00",
  ssim_threshold: 0.97,
  ssim_clip_min: 0.95,
  cpu_threads: null,
};

function makeRepo(settings: Partial<TranscodeQueueSettings> = {}, queued = 1) {
  const events: string[] = [];
  let left = queued;
  const job = {
    id: 7,
    batchId: "b",
    title: "T",
    mediaId: 1,
    mediaFileId: 2,
    step: null,
    estimatedBytes: 5n,
    settings: {
      codec: "hevc",
      encoder: "software",
      resolution: "keep",
      mode: "quality",
      preset: "balanced",
      speed: "default",
      convertLosslessAudio: false,
    },
    source: {
      dbPath: "/a.mkv",
      sizeBytes: 100n,
      fileMtimeMs: 1n,
      fileDev: null,
      fileIno: null,
    },
  };
  const repo = {
    getSettings: async () => ({ ...baseSettings, ...settings }),
    claimNext: async () => {
      if (left <= 0) return null;
      left--;
      events.push("claim");
      return job;
    },
    runningJobs: async () => [{ ...job, step: "replace" }],
    requeue: async (id: number) => {
      events.push(`requeue ${id}`);
    },
    markStep: async (_: number, s: string) => {
      events.push(`step ${s}`);
    },
    saveProgress: async () => {},
    finish: async (id: number) => {
      events.push(`finish ${id}`);
    },
    batchRemaining: async () => 0,
    batchSummary: async () => ({
      done: 1,
      failed: 0,
      savedBytes: 90n,
      pendingSeedBytes: 0n,
    }),
  };
  const notifier = {
    jobFailed: mock(async () => {}),
    batchFinished: mock(async () => {}),
  };
  return { repo, events, notifier };
}

const deps = {} as never;

describe("TranscodeDispatcher.tick", () => {
  it("claims, runs, finishes and notifies the finished batch", async () => {
    const { repo, events, notifier } = makeRepo();
    const d = new TranscodeDispatcher(repo as never, deps, notifier as never);
    await d.tick();
    expect(events).toEqual(["claim", "step encode", "finish 7"]);
    expect(notifier.batchFinished).toHaveBeenCalledTimes(1);
    expect(d.runningJobId()).toBeNull();
  });

  it("tick claims nothing when paused", async () => {
    const { repo, events } = makeRepo({ paused: true });
    await new TranscodeDispatcher(repo as never, deps, {
      jobFailed: async () => {},
      batchFinished: async () => {},
    }).tick();
    expect(events).toEqual([]);
  });

  it("tick claims nothing outside window", async () => {
    const { repo, events } = makeRepo({
      window_enabled: true,
      window_start: "01:00",
      window_end: "08:00",
    });
    const noon = () => new Date(2026, 0, 1, 12, 0);
    await new TranscodeDispatcher(
      repo as never,
      deps,
      { jobFailed: async () => {}, batchFinished: async () => {} },
      noon,
    ).tick();
    expect(events).toEqual([]);
  });

  it("claims inside the window", async () => {
    const { repo, events } = makeRepo({
      window_enabled: true,
      window_start: "01:00",
      window_end: "08:00",
    });
    const two = () => new Date(2026, 0, 1, 2, 0);
    await new TranscodeDispatcher(
      repo as never,
      deps,
      { jobFailed: async () => {}, batchFinished: async () => {} },
      two,
    ).tick();
    expect(events[0]).toBe("claim");
  });

  it("cancel returns false when the job is not running", () => {
    const { repo } = makeRepo();
    expect(
      new TranscodeDispatcher(repo as never, deps, {
        jobFailed: async () => {},
        batchFinished: async () => {},
      }).cancel(99),
    ).toBe(false);
  });
});

describe("TranscodeDispatcher.recover", () => {
  it("boot recovery runs recoverSwap for running jobs and requeues them", async () => {
    const { repo, events } = makeRepo();
    const seen: string[] = [];
    const fsDeps = {
      mapPath: (p: string) => p,
      probe: async () => {
        throw new Error("n/a");
      },
      fs: {
        exists: async (p: string) => {
          seen.push(`exists ${p}`);
          return false;
        },
        unlink: async (p: string) => {
          seen.push(`unlink ${p}`);
        },
        rename: async () => {},
        copyFile: async () => {},
        fsync: async () => {},
      },
    };
    const d = new TranscodeDispatcher(repo as never, fsDeps as never, {
      jobFailed: async () => {},
      batchFinished: async () => {},
    });
    await d.recover();
    expect(seen).toContain("exists /.a.mkv.rawkoon-orig");
    expect(seen).toContain("unlink /.a.rawkoon-tmp.mkv");
    expect(events).toContain("requeue 7");
  });
});

describe("TranscodeDispatcher resilience", () => {
  const quiet = { jobFailed: async () => {}, batchFinished: async () => {} };

  it("stop during a job requeues it instead of cancelling", async () => {
    const { repo, events } = makeRepo();
    pipelineImpl = (_j, _d, _h, opts) =>
      new Promise((res) =>
        opts.signal.addEventListener("abort", () =>
          res({ ok: false, cancelled: true, error: "Cancelled" }),
        ),
      );
    const d = new TranscodeDispatcher(repo as never, {} as never, quiet);
    const t = d.tick();
    await new Promise((r) => setTimeout(r, 5));
    await d.stop();
    await t;
    pipelineImpl = null;
    expect(events).toContain("requeue 7");
    expect(events).not.toContain("finish 7");
  });

  it("a failing settings read does not reject the tick", async () => {
    const { repo } = makeRepo();
    repo.getSettings = async () => {
      throw new Error("db down");
    };
    await expect(
      new TranscodeDispatcher(repo as never, {} as never, quiet).tick(),
    ).resolves.toBeUndefined();
  });

  it("a failing finish write does not leave the dispatcher busy", async () => {
    const { repo } = makeRepo({}, 2);
    repo.finish = async () => {
      throw new Error("db down");
    };
    const d = new TranscodeDispatcher(repo as never, {} as never, quiet);
    await expect(d.tick()).resolves.toBeUndefined();
    expect(d.runningJobId()).toBeNull();
  });

  it("a hanging notifier does not block the queue", async () => {
    const { repo, events } = makeRepo({}, 2);
    const hang = {
      jobFailed: () => new Promise<void>(() => {}),
      batchFinished: () => new Promise<void>(() => {}),
    };
    const d = new TranscodeDispatcher(repo as never, {} as never, hang);
    await d.tick();
    await d.tick();
    expect(events.filter((e) => e === "claim")).toHaveLength(2);
  });

  it("recovery registers a file that was already swapped instead of requeueing", async () => {
    const { repo, events } = makeRepo();
    const rescans: string[] = [];
    const deps = {
      mapPath: (x: string) => x,
      fingerprint: async () => null,
      probe: async () => ({
        video: { codec: "hevc" },
        sizeBytes: 40n,
        streams: [],
        durationSecs: 1,
      }),
      rescan: async (token: string) => {
        rescans.push(token);
      },
      fs: {
        exists: async (x: string) => x === "/a.mkv",
        size: async () => null,
        unlink: async () => {},
        rename: async () => {},
        link: async () => {},
        copyFile: async () => {},
        fsync: async () => {},
      },
    };
    await new TranscodeDispatcher(
      repo as never,
      deps as never,
      quiet,
    ).recover();
    expect(rescans).toEqual(["2|/a.mkv"]);
    expect(events).toContain("finish 7");
    expect(events).not.toContain("requeue 7");
  });
});
